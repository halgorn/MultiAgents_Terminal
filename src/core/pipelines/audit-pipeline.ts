import { randomUUID } from 'crypto';
import { readdirSync, statSync } from 'fs';
import { join as pathJoin } from 'path';
import { createWorktree, removeWorktree } from '../../infra/worktree.js';
import { ScannerAgent } from '../../agents/scanner.js';
import { SynthesizerAgent } from '../../agents/synthesizer.js';
import type { AuditReport } from '../../schemas/audit.js';
import type { RuntimePolicy } from '../runtime-policy.js';
import type { CostTracker } from '../cost-tracker.js';

type OnChunk = (agentName: string, text: string) => void;
type Emitter = (event: string, payload: unknown) => void;

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rb', '.rs', '.swift', '.kt', '.cs', '.cpp', '.c', '.h'];
const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.worktrees', 'coverage',
  '.next', '__pycache__', 'vendor', 'target', '.gradle', 'Pods',
  '.cache', 'tmp', 'temp', 'logs', 'fixtures', 'testdata',
]);
const IGNORE_PATTERNS = [
  /\.min\.[jt]sx?$/,
  /\.d\.ts$/,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /generated/i,
  /\.pb\.[jt]sx?$/,
];
const MAX_FILE_SIZE = 200 * 1024;

export class AuditPipeline {
  constructor(
    private readonly cwd: string,
    private readonly policy: RuntimePolicy,
    private readonly costs: CostTracker,
    private readonly emit: Emitter,
    private readonly onChunk: OnChunk,
  ) {}

  async run(target: string, numScanners = 5): Promise<AuditReport> {
    const taskId = randomUUID();
    const worktrees: Array<[string, string]> = [];

    try {
      const allFiles = this.collectSourceFiles(target);
      if (allFiles.length === 0) {
        return { findings: [], criticalCount: 0, highCount: 0, totalFiles: 0, summary: 'No source files found.', topPriorities: [] };
      }

      // Semgrep pre-scan (zero API tokens)
      const { runSemgrep } = await import('../../infra/semgrep.js');
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

      // Domain-based AI scanners (sequential to respect rate limits)
      const { SCAN_DOMAINS } = await import('../../prompts/scanner.js');
      const domains = SCAN_DOMAINS.slice(0, numScanners);
      const n = domains.length;

      this.emit('agent:output', {
        agentName: 'audit',
        text: `Found ${allFiles.length} source files → ${n} AI scanners (sequential, grep-first)\n  ${domains.join(' | ')}\n`,
      });

      const aiScannerRuns = await this.runSequential(
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
      );

      // Synthesize
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
      for (const [agentName, taskId_] of worktrees) {
        try { removeWorktree(this.cwd, agentName, taskId_); } catch { /* best-effort */ }
      }
    }
  }

  private async runSequential<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    const results: T[] = [];
    for (const task of tasks) results.push(await task());
    return results;
  }

  collectSourceFiles(_filter: string): string[] {
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

    walk(this.cwd, '');
    return results.sort();
  }

  prioritizeFiles(files: string[], max: number): string[] {
    if (files.length <= max) return files;

    const scored = files.map((f) => {
      let score = 0;
      const depth = f.split('/').length;
      score += Math.max(0, 6 - depth) * 3;

      const base = f.split('/').pop() ?? '';
      if (/^(index|main|app|server|router|handler|controller|service|middleware|auth|api)\.[a-z]+$/.test(base)) score += 10;
      if (/^(orchestrat|agent|provider|pipeline)\.[a-z]+$/.test(base)) score += 8;

      try {
        const size = statSync(pathJoin(this.cwd, f)).size;
        score += Math.min(5, Math.floor(size / 5000));
      } catch { /* skip */ }

      if (/\.(test|spec)\.[a-z]+$/.test(f)) score -= 5;
      return { f, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((s) => s.f)
      .sort();
  }
}
