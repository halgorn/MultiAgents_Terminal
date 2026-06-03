import { randomUUID } from 'crypto';
import { createTask, saveTaskResult } from '../../infra/db/task-repo.js';
import { saveEvidence } from '../../infra/db/evidence-repo.js';
import { KnowledgeStore } from '../../infra/knowledge.js';
import { PlannerAgent } from '../../agents/planner.js';
import { InvestigatorAgent } from '../../agents/investigator.js';
import { GraphAgent } from '../../agents/graph-agent.js';
import { transition, makeWorktreeTracker } from '../pipeline-context.js';
import type { PipelineContext } from '../pipeline-context.js';
import type { TaskResult } from '../task.js';
import type { TaskState } from '../state-machine.js';
import { pickInvestigatorDomains, mergeEvidence } from './fix-pipeline.js';

export async function runAnalyzePipeline(ctx: PipelineContext, target: string): Promise<TaskResult> {
  const req = { id: randomUUID(), command: 'analyze' as const, target, cwd: ctx.cwd, createdAt: new Date() };
  const task = createTask(req);
  const start = Date.now();
  const errors: string[] = [];
  const wt = makeWorktreeTracker(ctx.cwd);
  const knowledge = new KnowledgeStore(ctx.cwd);
  const graph = new GraphAgent(ctx.cwd);

  try {
    await transition(task, 'INVESTIGATING', ctx.emit);

    const codebaseSummary = knowledge.embeddings.hasIndex()
      ? await knowledge.buildContextSemantic(target)
      : knowledge.buildContext(target);
    const repoContext = await graph.queryWithContext(target);

    ctx.emit('agent:start', { agentName: 'planner' });
    const plannerWT = wt.create('planner', task.id);
    const planRun = await new PlannerAgent(ctx.policy.plannerProvider).run(
      { taskId: task.id, bugDescription: target, codebaseSummary, repoContext, worktreePath: plannerWT },
      ctx.policy,
      ctx.onChunk,
    );
    const plan = planRun.output;
    ctx.emit('agent:done', { agentName: 'planner', durationMs: planRun.durationMs });

    const isBugSpecific = plan.riskLevel !== 'low' || plan.phases.some((p) => p.agentType === 'investigator');

    if (!isBugSpecific) {
      await transition(task, 'REPRODUCED', ctx.emit, 'planner');
      const result: TaskResult = { taskId: task.id, state: 'REPRODUCED', plan, errors, durationMs: Date.now() - start };
      saveTaskResult(task.id, result);
      return result;
    }

    const domains = pickInvestigatorDomains(target, plan, ctx.policy);
    const investigatorWTs = domains.map((d) => wt.create(`investigator-${d}`, task.id));
    domains.forEach((d) => ctx.emit('agent:start', { agentName: `investigator-${d}` }));

    const evidenceRuns = await Promise.all(
      domains.map((domain, i) =>
        new InvestigatorAgent(domain, ctx.policy.investigatorProvider).run(
          { plan, bugDescription: target, worktreePath: investigatorWTs[i]!, domain },
          ctx.policy,
          ctx.onChunk,
        ),
      ),
    );

    evidenceRuns.forEach((run) => {
      ctx.emit('agent:done', { agentName: run.agentName, durationMs: run.durationMs });
      saveEvidence(task.id, run.agentName, run.agentName.replace('investigator-', ''), run.output);
    });

    const evidence = mergeEvidence(evidenceRuns.map((r) => r.output));
    const nextState: TaskState = evidence.reproduced ? 'REPRODUCED' : 'FAILED';
    await transition(task, nextState, ctx.emit, 'investigator');

    const result: TaskResult = { taskId: task.id, state: nextState, plan, evidence, errors, durationMs: Date.now() - start };
    saveTaskResult(task.id, result);
    return result;

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    ctx.emit('error', { taskId: task.id, message });
    if (task.state !== 'DONE' && task.state !== 'FAILED') {
      try { await transition(task, 'FAILED', ctx.emit); } catch { /* already failed */ }
    }
    const result: TaskResult = { taskId: task.id, state: 'FAILED', errors, durationMs: Date.now() - start };
    saveTaskResult(task.id, result);
    return result;
  } finally {
    wt.cleanup();
  }
}
