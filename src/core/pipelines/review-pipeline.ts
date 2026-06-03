import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { createTask, saveTaskResult } from '../../infra/db/task-repo.js';
import { ReviewerAgent } from '../../agents/reviewer.js';
import { transition, makeWorktreeTracker } from '../pipeline-context.js';
import type { PipelineContext } from '../pipeline-context.js';
import type { TaskResult } from '../task.js';
import type { TaskState } from '../state-machine.js';
import type { EvidenceReport } from '../../schemas/evidence.js';
import type { PatchReport } from '../../schemas/patch.js';

export async function runReviewPipeline(ctx: PipelineContext, target: string): Promise<TaskResult> {
  const req = { id: randomUUID(), command: 'review' as const, target, cwd: ctx.cwd, createdAt: new Date() };
  const task = createTask(req);
  const start = Date.now();
  const errors: string[] = [];
  const wt = makeWorktreeTracker(ctx.cwd);

  try {
    await transition(task, 'INVESTIGATING', ctx.emit);

    let diffContent = target;
    try { diffContent = readFileSync(target, 'utf8'); } catch { /* target is a description */ }

    const syntheticEvidence: EvidenceReport = {
      reproduced: true,
      confidence: 100,
      logs: ['review requested by user'],
      files: [{ path: target, line: 1, snippet: diffContent.slice(0, 200) }],
      summary: `Code review of: ${target}`,
    };

    const syntheticPatch: PatchReport = {
      filesChanged: [target],
      diff: diffContent,
      buildCommand: 'npm run build',
      testCommand: 'npm test',
      description: `Review of: ${target}`,
      risksIntroduced: [],
    };

    await transition(task, 'REPRODUCED', ctx.emit, 'system');
    await transition(task, 'ROOT_CAUSE_FOUND', ctx.emit, 'system');
    await transition(task, 'PATCH_CREATED', ctx.emit, 'system');

    ctx.emit('agent:start', { agentName: 'reviewer' });
    const reviewWT = wt.create('reviewer', task.id);
    const reviewRun = await new ReviewerAgent(ctx.policy.reviewerProvider).run(
      { patch: syntheticPatch, evidence: syntheticEvidence, worktreePath: reviewWT },
      ctx.policy,
      ctx.onChunk,
    );
    ctx.emit('agent:done', { agentName: 'reviewer', durationMs: reviewRun.durationMs });

    const nextState: TaskState = reviewRun.output.approved ? 'REVIEWED' : 'FAILED';
    await transition(task, nextState, ctx.emit, 'reviewer');

    const result: TaskResult = { taskId: task.id, state: nextState, review: reviewRun.output, errors, durationMs: Date.now() - start };
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
