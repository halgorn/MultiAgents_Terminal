import { randomUUID } from 'crypto';
import { createTask, saveTaskResult } from '../../infra/db/task-repo.js';
import { saveEvidence } from '../../infra/db/evidence-repo.js';
import type { FlowManifest } from '../../schemas/flow-manifest.js';
import { KnowledgeStore } from '../../infra/knowledge.js';
import { PlannerAgent } from '../../agents/planner.js';
import { InvestigatorAgent } from '../../agents/investigator.js';
import { DeveloperAgent } from '../../agents/developer.js';
import { ReviewerAgent } from '../../agents/reviewer.js';
import { GraphAgent } from '../../agents/graph-agent.js';
import { TestsAgent } from '../../agents/tests-agent.js';
import { detectLang } from '../../infra/lang-detect.js';
import { transition, makeWorktreeTracker } from '../pipeline-context.js';
import type { PipelineContext } from '../pipeline-context.js';
import type { TaskResult } from '../task.js';
import type { InvestigatorDomain } from '../../prompts/investigator.js';
import type { PlanReport } from '../../schemas/plan.js';
import type { EvidenceReport } from '../../schemas/evidence.js';

export function pickInvestigatorDomains(target: string, plan: PlanReport, policy: PipelineContext['policy']): InvestigatorDomain[] {
  if (policy.deep) {
    return ['backend', 'frontend', 'bug-history'].slice(0, policy.maxAgents) as InvestigatorDomain[];
  }

  const text = [
    target,
    plan.summary,
    plan.estimatedFiles.join(' '),
    plan.relevantModules.join(' '),
  ].join(' ').toLowerCase();

  const domain: InvestigatorDomain = /frontend|ui|component|react|css|browser|client/.test(text)
    ? 'frontend'
    : 'backend';
  return [domain];
}

export function mergeEvidence(reports: EvidenceReport[]): EvidenceReport {
  const reproduced = reports.filter((r) => r.reproduced);

  if (reproduced.length === 0) {
    const best = reports.reduce((a, b) => (a.confidence > b.confidence ? a : b));
    const acceptAsStatic = best.confidence >= 75 && best.files.length >= 1;
    return { ...best, reproduced: acceptAsStatic };
  }

  const primary = reproduced.reduce((a, b) => (a.confidence > b.confidence ? a : b));
  const allFiles = reproduced.flatMap((r) => r.files);
  const allLogs = reproduced.flatMap((r) => r.logs);

  const seenFiles = new Set<string>();
  const uniqueFiles = allFiles.filter((f) => {
    const key = `${f.path}:${f.line}`;
    if (seenFiles.has(key)) return false;
    seenFiles.add(key);
    return true;
  });

  return { ...primary, files: uniqueFiles, logs: [...new Set(allLogs)] };
}

export async function runFixPipeline(ctx: PipelineContext, target: string): Promise<TaskResult> {
  const req = { id: randomUUID(), command: 'fix' as const, target, cwd: ctx.cwd, createdAt: new Date() };
  const task = createTask(req);
  const start = Date.now();
  const errors: string[] = [];
  const wt = makeWorktreeTracker(ctx.cwd);

  const knowledge = new KnowledgeStore(ctx.cwd);
  const graph = new GraphAgent(ctx.cwd);
  const testsAgent = new TestsAgent(ctx.cwd);
  const langProfile = detectLang(ctx.cwd);

  let plan: PlanReport | undefined;
  let evidence: EvidenceReport | undefined;

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
    plan = planRun.output;
    ctx.emit('agent:done', { agentName: 'planner', durationMs: planRun.durationMs });

    const domains = pickInvestigatorDomains(target, plan, ctx.policy);
    const investigatorWTs = domains.map((d) => wt.create(`investigator-${d}`, task.id));
    domains.forEach((d) => ctx.emit('agent:start', { agentName: `investigator-${d}` }));

    const evidenceRuns = await Promise.all(
      domains.map((domain, i) =>
        new InvestigatorAgent(domain, ctx.policy.investigatorProvider).run(
          { plan: plan!, bugDescription: target, worktreePath: investigatorWTs[i]!, domain },
          ctx.policy,
          ctx.onChunk,
        ),
      ),
    );

    evidenceRuns.forEach((run) => {
      ctx.emit('agent:done', { agentName: run.agentName, durationMs: run.durationMs });
      saveEvidence(task.id, run.agentName, run.agentName.replace('investigator-', ''), run.output);
    });

    evidence = mergeEvidence(evidenceRuns.map((r) => r.output));

    if (!evidence.reproduced) {
      await transition(task, 'FAILED', ctx.emit, 'investigator');
      const result: TaskResult = { taskId: task.id, state: 'FAILED', plan, evidence, errors: ['Could not reproduce bug'], durationMs: Date.now() - start };
      saveTaskResult(task.id, result);
      return result;
    }

    await transition(task, 'REPRODUCED', ctx.emit, 'investigator');
    await transition(task, 'ROOT_CAUSE_FOUND', ctx.emit, 'investigator');

    ctx.emit('agent:start', { agentName: 'developer' });
    const devWT = wt.create('developer', task.id);
    const devRun = await new DeveloperAgent(ctx.policy.developerProvider).run(
      { evidence, plan, worktreePath: devWT, langProfile },
      ctx.policy,
      ctx.onChunk,
    );
    const patch = devRun.output;
    ctx.emit('agent:done', { agentName: 'developer', durationMs: devRun.durationMs });
    await transition(task, 'PATCH_CREATED', ctx.emit, 'developer');

    ctx.emit('agent:start', { agentName: 'reviewer' });
    const reviewRun = await new ReviewerAgent(ctx.policy.reviewerProvider).run(
      { patch, evidence, worktreePath: devWT },
      ctx.policy,
      ctx.onChunk,
    );
    const review = reviewRun.output;
    ctx.emit('agent:done', { agentName: 'reviewer', durationMs: reviewRun.durationMs });

    if (!review.approved) {
      await transition(task, 'FAILED', ctx.emit, 'reviewer');
      const result: TaskResult = { taskId: task.id, state: 'FAILED', plan, evidence, patch, review, errors: review.blockers, durationMs: Date.now() - start };
      saveTaskResult(task.id, result);
      return result;
    }

    await transition(task, 'REVIEWED', ctx.emit, 'reviewer');

    ctx.emit('agent:start', { agentName: 'qa' });
    const qaStart = Date.now();
    const { qaResult } = await testsAgent.run(devWT, patch, evidence, ctx.policy, ctx.onChunk);
    ctx.emit('agent:done', { agentName: 'qa', durationMs: Date.now() - qaStart });

    if (!qaResult.buildOk) throw new Error(`Verification policy failed: build did not pass. ${qaResult.failureReason ?? ''}`);
    if (!qaResult.testsOk) throw new Error(`Verification policy failed: tests did not pass. ${qaResult.failureReason ?? ''}`);
    if (qaResult.reproductionStillFails) throw new Error('Verification policy failed: original bug still reproducible after patch.');

    await transition(task, 'TESTED', ctx.emit, 'qa');
    await transition(task, 'VERIFIED', ctx.emit, 'qa');
    await transition(task, 'DONE', ctx.emit, 'qa');

    if (evidence && patch) {
      try {
        knowledge.writeEntry('bugs', target.slice(0, 60), [
          `## Root Cause\n${evidence.rootCause ?? evidence.summary}`,
          `## Fix\n${patch.description}`,
          `## Files Changed\n${patch.filesChanged.join(', ')}`,
          `## Confidence\n${evidence.confidence}%`,
        ].join('\n\n'));
      } catch { /* best-effort */ }
    }

    const result: TaskResult = { taskId: task.id, state: 'DONE', plan, evidence, patch, review, qaResult, errors: [], durationMs: Date.now() - start };
    saveTaskResult(task.id, result);
    return result;

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    ctx.emit('error', { taskId: task.id, message });
    if (task.state !== 'DONE' && task.state !== 'FAILED') {
      try { await transition(task, 'FAILED', ctx.emit); } catch { /* already failed */ }
    }
    const result: TaskResult = { taskId: task.id, state: 'FAILED', plan, evidence, errors, durationMs: Date.now() - start };
    saveTaskResult(task.id, result);
    return result;
  } finally {
    wt.cleanup();
  }
}

export const manifest: FlowManifest = {
  name: 'fix',
  description: 'Plans, implements, reviews, and tests a fix for a given target finding',
  inputDescription: 'target: file path or finding description',
  outputSchema: 'TaskResult',
  agentSequence: ['planner', 'investigator', 'developer', 'reviewer', 'qa'],
  failureStrategy: 'abort',
};
