import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join as pathJoin } from 'path';
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
import { ScannerAgent } from '../agents/scanner.js';
import { SynthesizerAgent } from '../agents/synthesizer.js';
import { runLocalQA } from '../infra/local-qa.js';
import { createRuntimePolicy, type RuntimePolicy, type RuntimePolicyInput } from './runtime-policy.js';
import type { EvidenceReport } from '../schemas/evidence.js';
import type { PlanReport } from '../schemas/plan.js';
import type { PatchReport } from '../schemas/patch.js';
import type { ReviewReport } from '../schemas/review.js';
import type { QAResult } from '../schemas/qa.js';
import type { AuditReport } from '../schemas/audit.js';
import type { InvestigatorDomain } from '../prompts/investigator.js';

export interface OrchestratorEvents {
  'state:change': { taskId: string; state: TaskState };
  'agent:output': { agentName: string; text: string };
  'agent:start': { agentName: string };
  'agent:done': { agentName: string; durationMs: number };
  error: { taskId: string; message: string };
}

export class Orchestrator extends EventEmitter {
  private readonly knowledge: KnowledgeStore;
  private readonly policy: RuntimePolicy;

  constructor(private readonly cwd: string, policyInput: RuntimePolicyInput = {}) {
    super();
    this.knowledge = new KnowledgeStore(cwd);
    this.policy = createRuntimePolicy(policyInput);
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

      const planRun = await new PlannerAgent(this.policy.plannerProvider).run(
        { taskId: task.id, bugDescription: target, codebaseSummary, worktreePath: plannerWT },
        this.policy,
        this.onChunk,
      );
      plan = planRun.output;
      this.emit('agent:done', { agentName: 'planner', durationMs: planRun.durationMs });

      const resolvedPlan = plan;
      const domains = this.pickInvestigatorDomains(target, resolvedPlan);
      const investigatorWTs = domains.map((d) => {
        const wt = createWorktree(this.cwd, `investigator-${d}`, task.id);
        worktrees.push([`investigator-${d}`, task.id]);
        return wt;
      });

      domains.forEach((d) => this.emit('agent:start', { agentName: `investigator-${d}` }));

      const evidenceRuns = await Promise.all(
        domains.map((domain, i) =>
          new InvestigatorAgent(domain, this.policy.investigatorProvider).run(
            { plan: resolvedPlan, bugDescription: target, worktreePath: investigatorWTs[i]!, domain },
            this.policy,
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

      const devRun = await new DeveloperAgent(this.policy.developerProvider).run(
        { evidence, plan, worktreePath: devWT },
        this.policy,
        this.onChunk,
      );
      patch = devRun.output;
      this.emit('agent:done', { agentName: 'developer', durationMs: devRun.durationMs });
      await this.transition(task, 'PATCH_CREATED', 'developer');

      // Reviewer inspects the developer worktree so it sees the actual patch.
      this.emit('agent:start', { agentName: 'reviewer' });
      const reviewRun = await new ReviewerAgent(this.policy.reviewerProvider).run(
        { patch, evidence, worktreePath: devWT },
        this.policy,
        this.onChunk,
      );
      review = reviewRun.output;
      this.emit('agent:done', { agentName: 'reviewer', durationMs: reviewRun.durationMs });

      if (!review.approved) {
        await this.transition(task, 'FAILED', 'reviewer');
        const result: TaskResult = { taskId: task.id, state: 'FAILED', plan, evidence, patch, review, errors: review.blockers, durationMs: Date.now() - start };
        saveTaskResult(task.id, result);
        return result;
      }

      await this.transition(task, 'REVIEWED', 'reviewer');

      this.emit('agent:start', { agentName: 'qa' });
      const qaStart = Date.now();
      qaResult = runLocalQA(devWT, patch, evidence, this.policy);
      this.emit('agent:done', { agentName: 'qa', durationMs: Date.now() - qaStart });

      this.assertVerificationPolicy(qaResult);
      await this.transition(task, 'TESTED', 'qa');
      await this.transition(task, 'VERIFIED', 'qa');
      await this.transition(task, 'DONE', 'qa');

      // Auto-save to .ai-memory/bugs/ so future runs benefit from this fix
      if (evidence && patch) {
        try {
          this.knowledge.writeEntry('bugs', task.target.slice(0, 60), [
            `## Root Cause\n${evidence.rootCause ?? evidence.summary}`,
            `## Fix\n${patch.description}`,
            `## Files Changed\n${patch.filesChanged.join(', ')}`,
            `## Confidence\n${evidence.confidence}%`,
          ].join('\n\n'));
        } catch { /* best-effort — don't fail the task */ }
      }

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
      const planRun = await new PlannerAgent(this.policy.plannerProvider).run(
        { taskId: task.id, bugDescription: target, codebaseSummary, worktreePath: plannerWT },
        this.policy,
        this.onChunk,
      );
      const plan = planRun.output;
      this.emit('agent:done', { agentName: 'planner', durationMs: planRun.durationMs });

      // For general analysis/audit tasks, stop after the planner — it already provides
      // the full structural analysis. Investigators are for specific bug reproduction.
      const isBugSpecific = plan.riskLevel !== 'low' || plan.phases.some(
        (p) => p.agentType === 'investigator',
      );

      if (!isBugSpecific) {
        await this.transition(task, 'REPRODUCED', 'planner');
        const result: TaskResult = { taskId: task.id, state: 'REPRODUCED', plan, errors, durationMs: Date.now() - start };
        saveTaskResult(task.id, result);
        return result;
      }

      const domains = this.pickInvestigatorDomains(target, plan);
      const investigatorWTs = domains.map((d) => {
        const wt = createWorktree(this.cwd, `investigator-${d}`, task.id);
        worktrees.push([`investigator-${d}`, task.id]);
        return wt;
      });

      domains.forEach((d) => this.emit('agent:start', { agentName: `investigator-${d}` }));

      const evidenceRuns = await Promise.all(
        domains.map((domain, i) =>
          new InvestigatorAgent(domain, this.policy.investigatorProvider).run(
            { plan, bugDescription: target, worktreePath: investigatorWTs[i]!, domain },
            this.policy,
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
      const reviewRun = await new ReviewerAgent(this.policy.reviewerProvider).run(
        { patch: syntheticPatch, evidence: syntheticEvidence, worktreePath: reviewWT },
        this.policy,
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
      const best = reports.reduce((a, b) => (a.confidence > b.confidence ? a : b));
      // Accept high-confidence static analysis as reproduced when confidence >= 75 and has file evidence
      const acceptAsStatic = best.confidence >= 75 && best.files.length >= 1;
      return { ...best, reproduced: acceptAsStatic };
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

  private pickInvestigatorDomains(target: string, plan: PlanReport): InvestigatorDomain[] {
    if (this.policy.deep) {
      return ['backend', 'frontend', 'bug-history'].slice(0, this.policy.maxAgents) as InvestigatorDomain[];
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

  private async runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let index = 0;

    const worker = async () => {
      while (index < tasks.length) {
        const i = index++;
        results[i] = await tasks[i]!();
      }
    };

    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
  }

  private cleanupWorktrees(pairs: Array<[string, string]>): void {
    for (const [agentName, taskId] of pairs) {
      try { removeWorktree(this.cwd, agentName, taskId); } catch { /* best-effort */ }
    }
  }

  // ── Audit Pipeline ─────────────────────────────────────────────────────────

  async runAuditPipeline(target: string, numScanners = 5): Promise<AuditReport> {
    const taskId = randomUUID();
    const worktrees: Array<[string, string]> = [];

    try {
      // 1. Collect source files for metadata
      const allFiles = this.collectSourceFiles(this.cwd, target);
      if (allFiles.length === 0) {
        return { findings: [], criticalCount: 0, highCount: 0, totalFiles: 0, summary: 'No source files found.', topPriorities: [] };
      }

      // 2. Pre-scan with Semgrep (zero API tokens — runs locally)
      const { runSemgrep } = await import('../infra/semgrep.js');
      this.emit('agent:output', { agentName: 'audit', text: '\nRunning Semgrep pre-scan (no API tokens)...\n' });
      const semgrepResult = runSemgrep(this.cwd);
      const semgrepReport = {
        filesScanned: semgrepResult.available ? allFiles.slice(0, semgrepResult.filesScanned) : [],
        findings: semgrepResult.findings,
        summary: semgrepResult.available
          ? `Semgrep found ${semgrepResult.findings.length} issues across ${semgrepResult.filesScanned} files.`
          : `Semgrep unavailable: ${semgrepResult.error}`,
      };
      if (semgrepResult.available) {
        this.emit('agent:output', { agentName: 'audit', text: `Semgrep: ${semgrepResult.findings.length} findings in ${semgrepResult.filesScanned} files\n` });
      }

      // 3. Domain-based AI scanners (grep-first, sequential to respect rate limits)
      const { SCAN_DOMAINS } = await import('../prompts/scanner.js');
      const domains = SCAN_DOMAINS.slice(0, numScanners);
      const n = domains.length;

      this.emit('agent:output', {
        agentName: 'audit',
        text: `Found ${allFiles.length} source files → ${n} AI scanners (sequential, grep-first)\n  ${domains.join(' | ')}\n`,
      });

      const aiScannerRuns = await this.runWithConcurrency(
        domains.map((domain, i) => async () => {
          const wt = createWorktree(this.cwd, `scanner-${domain}`, taskId);
          worktrees.push([`scanner-${domain}`, taskId]);
          this.emit('agent:start', { agentName: `scanner-${domain}` });

          const run = await new ScannerAgent(domain, i, n).run(
            { domain, worktreePath: wt, scannerIndex: i, totalScanners: n },
            this.policy,
            this.onChunk,
          );

          this.emit('agent:done', { agentName: `scanner-${domain}`, durationMs: run.durationMs });
          return run.output;
        }),
        1,
      );

      // 4. Synthesize: semgrep + AI findings together
      const synthWT = createWorktree(this.cwd, 'synthesizer', taskId);
      worktrees.push(['synthesizer', taskId]);
      this.emit('agent:start', { agentName: 'synthesizer' });

      const synthRun = await new SynthesizerAgent().run(
        { scanReports: [semgrepReport, ...aiScannerRuns], totalFiles: allFiles.length, worktreePath: synthWT },
        this.policy,
        this.onChunk,
      );

      this.emit('agent:done', { agentName: 'synthesizer', durationMs: synthRun.durationMs });
      return synthRun.output;

    } finally {
      this.cleanupWorktrees(worktrees);
    }
  }

  private collectSourceFiles(cwd: string, _filter: string): string[] {
    const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rb', '.rs', '.swift', '.kt', '.cs', '.cpp', '.c', '.h'];
    const IGNORE_DIRS = new Set([
      'node_modules', 'dist', 'build', '.git', '.worktrees', 'coverage',
      '.next', '__pycache__', 'vendor', 'target', '.gradle', 'Pods',
      '.cache', 'tmp', 'temp', 'logs', 'fixtures', 'testdata',
    ]);
    const IGNORE_PATTERNS = [
      /\.min\.[jt]sx?$/,     // minified
      /\.d\.ts$/,            // type declarations
      /\.test\.[jt]sx?$/,    // test files (scan separately if needed)
      /\.spec\.[jt]sx?$/,
      /generated/i,
      /\.pb\.[jt]sx?$/,      // protobuf generated
    ];
    const MAX_FILE_SIZE = 200 * 1024; // skip files > 200KB

    const results: string[] = [];

    const walk = (dir: string, rel: string) => {
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }

      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
        const fullPath = pathJoin(dir, entry);
        const relPath = rel ? `${rel}/${entry}` : entry;
        try {
          const st = statSync(fullPath);
          if (st.isDirectory()) {
            walk(fullPath, relPath);
          } else if (
            SOURCE_EXTS.some((ext) => entry.endsWith(ext)) &&
            !IGNORE_PATTERNS.some((p) => p.test(relPath)) &&
            st.size < MAX_FILE_SIZE
          ) {
            results.push(relPath);
          }
        } catch { /* skip unreadable */ }
      }
    };

    walk(cwd, '');
    return results.sort();
  }

  private prioritizeFiles(files: string[], max: number): string[] {
    if (files.length <= max) return files;

    // Score each file by importance (higher = more important to scan)
    const scored = files.map((f) => {
      let score = 0;

      // Shallow paths are entry points / core modules
      const depth = f.split('/').length;
      score += Math.max(0, 6 - depth) * 3;

      // Key filenames
      const base = f.split('/').pop() ?? '';
      if (/^(index|main|app|server|router|handler|controller|service|middleware|auth|api)\.[a-z]+$/.test(base)) score += 10;
      if (/^(orchestrat|agent|provider|pipeline)\.[a-z]+$/.test(base)) score += 8;

      // Larger files are more likely to have issues
      try {
        const size = statSync(pathJoin(this.cwd, f)).size;
        score += Math.min(5, Math.floor(size / 5000));
      } catch { /* skip */ }

      // Penalize test/spec files (still audit them but lower priority)
      if (/\.(test|spec)\.[a-z]+$/.test(f)) score -= 5;

      return { f, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((s) => s.f)
      .sort(); // restore alphabetical order for readable output
  }

  private splitIntoChunks<T>(arr: T[], n: number): T[][] {
    const chunks: T[][] = Array.from({ length: n }, () => []);
    arr.forEach((item, i) => chunks[i % n]!.push(item));
    return chunks.filter((c) => c.length > 0);
  }
}
