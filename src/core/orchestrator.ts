import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import type { TaskRequest, TaskRecord, TaskResult } from './task.js';
import { assertTransition, type TaskState } from './state-machine.js';
import { createTask, updateTaskState, saveTaskResult, logStateHistory } from '../infra/db/task-repo.js';
import { saveEvidence } from '../infra/db/evidence-repo.js';
import { createWorktree, removeWorktree } from '../infra/worktree.js';
import { KnowledgeStore } from '../infra/knowledge.js';
import { PlannerAgent } from '../agents/planner.js';
import { InvestigatorAgent } from '../agents/investigator.js';
import { DeveloperAgent } from '../agents/developer.js';
import { ReviewerAgent } from '../agents/reviewer.js';
import { QAAgent } from '../agents/qa.js';
import type { EvidenceReport } from '../schemas/evidence.js';
import type { PlanReport } from '../schemas/plan.js';
import type { PatchReport } from '../schemas/patch.js';
import type { ReviewReport } from '../schemas/review.js';
import type { QAResult } from '../schemas/qa.js';

export interface OrchestratorEvents {
  'state:change': { taskId: string; state: TaskState };
  'agent:output': { agentName: string; text: string };
  'agent:start': { agentName: string };
  'agent:done': { agentName: string; durationMs: number };
  error: { taskId: string; message: string };
}

export class Orchestrator extends EventEmitter {
  private readonly knowledge: KnowledgeStore;

  constructor(private readonly cwd: string) {
    super();
    this.knowledge = new KnowledgeStore(cwd);
  }

  private onChunk = (agentName: string, text: string): void => {
    this.emit('agent:output', { agentName, text });
  };

  private async transition(task: TaskRecord, to: TaskState, agentName?: string): Promise<void> {
    assertTransition(task.state, to);
    const from = task.state;
    task.state = to;
    updateTaskState(task.id, to);
    logStateHistory(task.id, from, to, agentName);
    this.emit('state:change', { taskId: task.id, state: to });
  }

  async runFixPipeline(target: string): Promise<TaskResult> {
    const req: TaskRequest = {
      id: randomUUID(),
      command: 'fix',
      target,
      cwd: this.cwd,
      createdAt: new Date(),
    };

    const task = createTask(req);
    const start = Date.now();
    const errors: string[] = [];

    let plan: PlanReport | undefined;
    let evidence: EvidenceReport | undefined;
    let patch: PatchReport | undefined;
    let review: ReviewReport | undefined;
    let qaResult: QAResult | undefined;

    const worktrees: Array<[string, string]> = []; // [agentName, taskId] pairs for cleanup

    try {
      await this.transition(task, 'INVESTIGATING');

      // Planner
      const codebaseSummary = this.knowledge.buildContext(target);
      this.emit('agent:start', { agentName: 'planner' });
      const plannerWT = createWorktree(this.cwd, 'planner', task.id);
      worktrees.push(['planner', task.id]);

      const planRun = await new PlannerAgent().run(
        { taskId: task.id, bugDescription: target, codebaseSummary, worktreePath: plannerWT },
        this.onChunk,
      );
      plan = planRun.output;
      this.emit('agent:done', { agentName: 'planner', durationMs: planRun.durationMs });

      // 3 parallel Investigators
      const resolvedPlan = plan;
      const domains = ['backend', 'frontend', 'bug-history'] as const;
      const investigatorWTs = domains.map((d) => {
        const wt = createWorktree(this.cwd, `investigator-${d}`, task.id);
        worktrees.push([`investigator-${d}`, task.id]);
        return wt;
      });

      domains.forEach((d) => this.emit('agent:start', { agentName: `investigator-${d}` }));

      const evidenceRuns = await Promise.all(
        domains.map((domain, i) =>
          new InvestigatorAgent(domain).run(
            { plan: resolvedPlan, bugDescription: target, worktreePath: investigatorWTs[i]!, domain },
            this.onChunk,
          ),
        ),
      );

      evidenceRuns.forEach((run) => {
        this.emit('agent:done', { agentName: run.agentName, durationMs: run.durationMs });
        saveEvidence(task.id, run.agentName, run.agentName.replace('investigator-', ''), run.output);
      });

      evidence = this.mergeEvidence(evidenceRuns.map((r) => r.output));

      if (!evidence.reproduced) {
        await this.transition(task, 'FAILED', 'investigator');
        const result: TaskResult = { taskId: task.id, state: 'FAILED', plan, evidence, errors: ['Could not reproduce bug'], durationMs: Date.now() - start };
        saveTaskResult(task.id, result);
        return result;
      }

      await this.transition(task, 'REPRODUCED', 'investigator');
      await this.transition(task, 'ROOT_CAUSE_FOUND', 'investigator');

      // Developer
      this.emit('agent:start', { agentName: 'developer' });
      const devWT = createWorktree(this.cwd, 'developer', task.id);
      worktrees.push(['developer', task.id]);

      const devRun = await new DeveloperAgent().run(
        { evidence, plan, worktreePath: devWT },
        this.onChunk,
      );
      patch = devRun.output;
      this.emit('agent:done', { agentName: 'developer', durationMs: devRun.durationMs });
      await this.transition(task, 'PATCH_CREATED', 'developer');

      // Reviewer inspects the developer worktree so it sees the actual patch.
      this.emit('agent:start', { agentName: 'reviewer' });
      const reviewRun = await new ReviewerAgent().run({ patch, evidence, worktreePath: devWT }, this.onChunk);
      review = reviewRun.output;
      this.emit('agent:done', { agentName: 'reviewer', durationMs: reviewRun.durationMs });

      if (!review.approved) {
        await this.transition(task, 'FAILED', 'reviewer');
        const result: TaskResult = { taskId: task.id, state: 'FAILED', plan, evidence, patch, review, errors: review.blockers, durationMs: Date.now() - start };
        saveTaskResult(task.id, result);
        return result;
      }

      await this.transition(task, 'REVIEWED', 'reviewer');

      // QA runs in the developer worktree because the patch is applied there.
      this.emit('agent:start', { agentName: 'qa' });
      const qaRun = await new QAAgent().run({ patch, evidence, worktreePath: devWT }, this.onChunk);
      qaResult = qaRun.output;
      this.emit('agent:done', { agentName: 'qa', durationMs: qaRun.durationMs });

      this.assertVerificationPolicy(qaResult);
      await this.transition(task, 'TESTED', 'qa');
      await this.transition(task, 'VERIFIED', 'qa');
      await this.transition(task, 'DONE', 'qa');

      const result: TaskResult = { taskId: task.id, state: 'DONE', plan, evidence, patch, review, qaResult, errors: [], durationMs: Date.now() - start };
      saveTaskResult(task.id, result);
      return result;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      this.emit('error', { taskId: task.id, message });

      if (task.state !== 'DONE' && task.state !== 'FAILED') {
        try { await this.transition(task, 'FAILED'); } catch { /* already failed */ }
      }

      const result: TaskResult = { taskId: task.id, state: 'FAILED', plan, evidence, patch, review, qaResult, errors, durationMs: Date.now() - start };
      saveTaskResult(task.id, result);
      return result;

    } finally {
      this.cleanupWorktrees(worktrees);
    }
  }

  async runAnalyzePipeline(target: string): Promise<TaskResult> {
    const req: TaskRequest = {
      id: randomUUID(),
      command: 'analyze',
      target,
      cwd: this.cwd,
      createdAt: new Date(),
    };

    const task = createTask(req);
    const start = Date.now();
    const errors: string[] = [];
    const worktrees: Array<[string, string]> = [];

    try {
      await this.transition(task, 'INVESTIGATING');

      const codebaseSummary = this.knowledge.buildContext(target);
      const plannerWT = createWorktree(this.cwd, 'planner', task.id);
      worktrees.push(['planner', task.id]);

      this.emit('agent:start', { agentName: 'planner' });
      const planRun = await new PlannerAgent().run(
        { taskId: task.id, bugDescription: target, codebaseSummary, worktreePath: plannerWT },
        this.onChunk,
      );
      const plan = planRun.output;
      this.emit('agent:done', { agentName: 'planner', durationMs: planRun.durationMs });

      const domains = ['backend', 'frontend', 'bug-history'] as const;
      const investigatorWTs = domains.map((d) => {
        const wt = createWorktree(this.cwd, `investigator-${d}`, task.id);
        worktrees.push([`investigator-${d}`, task.id]);
        return wt;
      });

      domains.forEach((d) => this.emit('agent:start', { agentName: `investigator-${d}` }));

      const evidenceRuns = await Promise.all(
        domains.map((domain, i) =>
          new InvestigatorAgent(domain).run(
            { plan, bugDescription: target, worktreePath: investigatorWTs[i]!, domain },
            this.onChunk,
          ),
        ),
      );

      evidenceRuns.forEach((run) => {
        this.emit('agent:done', { agentName: run.agentName, durationMs: run.durationMs });
        saveEvidence(task.id, run.agentName, run.agentName.replace('investigator-', ''), run.output);
      });

      const evidence = this.mergeEvidence(evidenceRuns.map((r) => r.output));
      const nextState: TaskState = evidence.reproduced ? 'REPRODUCED' : 'FAILED';
      await this.transition(task, nextState, 'investigator');

      const result: TaskResult = { taskId: task.id, state: nextState, plan, evidence, errors, durationMs: Date.now() - start };
      saveTaskResult(task.id, result);
      return result;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      this.emit('error', { taskId: task.id, message });
      if (task.state !== 'DONE' && task.state !== 'FAILED') {
        try { await this.transition(task, 'FAILED'); } catch { /* already failed */ }
      }
      const result: TaskResult = { taskId: task.id, state: 'FAILED', errors, durationMs: Date.now() - start };
      saveTaskResult(task.id, result);
      return result;
    } finally {
      this.cleanupWorktrees(worktrees);
    }
  }

  async runReviewPipeline(target: string): Promise<TaskResult> {
    const req: TaskRequest = {
      id: randomUUID(),
      command: 'review',
      target,
      cwd: this.cwd,
      createdAt: new Date(),
    };

    const task = createTask(req);
    const start = Date.now();
    const errors: string[] = [];
    const worktrees: Array<[string, string]> = [];

    try {
      await this.transition(task, 'INVESTIGATING');

      // Read target file/diff content if it exists
      let diffContent = target;
      try {
        diffContent = readFileSync(target, 'utf8');
      } catch { /* target is a description, not a file path */ }

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

      await this.transition(task, 'REPRODUCED', 'system');
      await this.transition(task, 'ROOT_CAUSE_FOUND', 'system');
      await this.transition(task, 'PATCH_CREATED', 'system');

      this.emit('agent:start', { agentName: 'reviewer' });
      const reviewWT = createWorktree(this.cwd, 'reviewer', task.id);
      worktrees.push(['reviewer', task.id]);
      const reviewRun = await new ReviewerAgent().run(
        { patch: syntheticPatch, evidence: syntheticEvidence, worktreePath: reviewWT },
        this.onChunk,
      );
      this.emit('agent:done', { agentName: 'reviewer', durationMs: reviewRun.durationMs });

      const nextState: TaskState = reviewRun.output.approved ? 'REVIEWED' : 'FAILED';
      await this.transition(task, nextState, 'reviewer');

      const result: TaskResult = { taskId: task.id, state: nextState, review: reviewRun.output, errors, durationMs: Date.now() - start };
      saveTaskResult(task.id, result);
      return result;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      this.emit('error', { taskId: task.id, message });
      if (task.state !== 'DONE' && task.state !== 'FAILED') {
        try { await this.transition(task, 'FAILED'); } catch { /* already failed */ }
      }
      const result: TaskResult = { taskId: task.id, state: 'FAILED', errors, durationMs: Date.now() - start };
      saveTaskResult(task.id, result);
      return result;
    } finally {
      this.cleanupWorktrees(worktrees);
    }
  }

  private mergeEvidence(reports: EvidenceReport[]): EvidenceReport {
    const reproduced = reports.filter((r) => r.reproduced);

    if (reproduced.length === 0) {
      // Best non-reproduced report to surface what was found
      const best = reports.reduce((a, b) => (a.confidence > b.confidence ? a : b));
      return { ...best, reproduced: false };
    }

    // Highest confidence reproduced report wins; merge files and logs from all
    const primary = reproduced.reduce((a, b) => (a.confidence > b.confidence ? a : b));
    const allFiles = reproduced.flatMap((r) => r.files);
    const allLogs = reproduced.flatMap((r) => r.logs);

    // Deduplicate files by path+line
    const seenFiles = new Set<string>();
    const uniqueFiles = allFiles.filter((f) => {
      const key = `${f.path}:${f.line}`;
      if (seenFiles.has(key)) return false;
      seenFiles.add(key);
      return true;
    });

    return {
      ...primary,
      files: uniqueFiles,
      logs: [...new Set(allLogs)],
    };
  }

  private assertVerificationPolicy(qa: QAResult): void {
    if (!qa.buildOk) {
      throw new Error(`Verification policy failed: build did not pass. ${qa.failureReason ?? ''}`);
    }
    if (!qa.testsOk) {
      throw new Error(`Verification policy failed: tests did not pass. ${qa.failureReason ?? ''}`);
    }
    if (qa.reproductionStillFails) {
      throw new Error('Verification policy failed: original bug still reproducible after patch.');
    }
  }

  private cleanupWorktrees(pairs: Array<[string, string]>): void {
    for (const [agentName, taskId] of pairs) {
      try { removeWorktree(this.cwd, agentName, taskId); } catch { /* best-effort */ }
    }
  }
}
