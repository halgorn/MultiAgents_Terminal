import { randomUUID } from 'crypto';
import { readdirSync, statSync } from 'fs';
import { join as pathJoin } from 'path';
import { createWorktree, removeWorktree } from '../../infra/worktree.js';
import { ScannerAgent } from '../../agents/scanner.js';
import { SynthesizerAgent } from '../../agents/synthesizer.js';
import type { AuditFinding, AuditReport, ScanReport } from '../../schemas/audit.js';
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
const MAX_SEMGREP_FINDINGS_FOR_SYNTHESIS = 30;
const MAX_FINDINGS_PER_SCANNER = 15;
const MAX_FINDING_TEXT = 360;

function severityRank(severity: string): number {
  switch (severity) {
    case 'critical': return 5;
    case 'high': return 4;
    case 'medium': return 3;
    case 'low': return 2;
    default: return 1;
  }
}

export interface AuditFileStats {
  totalFiles: number;
  auditFiles: string[];
  ignoredDirs: number;
  ignoredFiles: number;
  oversizedFiles: number;
  byExtension: Record<string, number>;
}

function compactText(text: string, max = MAX_FINDING_TEXT): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function compactFinding(finding: AuditFinding): AuditFinding {
  return {
    ...finding,
    finding: compactText(finding.finding),
    recommendation: compactText(finding.recommendation),
  };
}

export function compactScanReport(report: ScanReport, maxFindings = MAX_FINDINGS_PER_SCANNER): ScanReport {
  const findings = report.findings
    .map(compactFinding)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, maxFindings);
  return {
    filesScanned: report.filesScanned.slice(0, 80),
    findings,
    summary: compactText(report.summary, 700),
  };
}

export function fallbackAuditReport(scanReports: ScanReport[], totalFiles: number): AuditReport {
  const seen = new Set<string>();
  const findings = scanReports
    .flatMap((report) => report.findings)
    .map(compactFinding)
    .filter((finding) => {
      const key = `${finding.file}:${finding.line ?? ''}:${finding.finding}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  return {
    findings,
    criticalCount: findings.filter((f) => f.severity === 'critical').length,
    highCount: findings.filter((f) => f.severity === 'high').length,
    totalFiles,
    summary: `Local fallback merged ${findings.length} findings from ${scanReports.length} scanner reports.`,
    topPriorities: findings.slice(0, 5).map((f) => `${f.severity}: ${f.file}${f.line ? `:${f.line}` : ''} — ${f.finding}`),
  };
}

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
      const stats = this.collectAuditStats(target);
      const allFiles = stats.auditFiles;
      if (allFiles.length === 0) {
        return { findings: [], criticalCount: 0, highCount: 0, totalFiles: 0, summary: 'No source files found.', topPriorities: [] };
      }

      // Semgrep pre-scan (zero API tokens)
      const { runSemgrep } = await import('../../infra/semgrep.js');
      this.emit('agent:output', { agentName: 'audit', text: '\nRunning Semgrep pre-scan (no API tokens)...\n' });
      const semgrepResult = runSemgrep(this.cwd);
      const semgrepFindings = semgrepResult.findings
        .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
        .slice(0, MAX_SEMGREP_FINDINGS_FOR_SYNTHESIS);
      const semgrepReport: ScanReport = {
        filesScanned: semgrepResult.available ? allFiles.slice(0, semgrepResult.filesScanned) : [],
        findings: semgrepFindings,
        summary: semgrepResult.available
          ? `Semgrep found ${semgrepResult.findings.length} issues across ${semgrepResult.filesScanned} files; top ${semgrepFindings.length} included for synthesis.`
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

          const start = Date.now();
          try {
            const run = await new ScannerAgent(domain, i, n).run(
              { domain, worktreePath: wt, scannerIndex: i, totalScanners: n },
              this.policy,
              this.onChunk,
            );
            this.emit('agent:done', { agentName: `scanner-${domain}`, durationMs: run.durationMs });
            return compactScanReport(run.output);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.emit('agent:output', { agentName: `scanner-${domain}`, text: `Scanner failed; continuing with partial audit: ${message}\n` });
            this.emit('agent:done', { agentName: `scanner-${domain}`, durationMs: Date.now() - start });
            return {
              filesScanned: [],
              findings: [],
              summary: `Scanner ${domain} failed: ${compactText(message, 500)}`,
            };
          }
        }),
      );

      // Synthesize
      const synthWT = createWorktree(this.cwd, 'synthesizer', taskId);
      worktrees.push(['synthesizer', taskId]);
      this.emit('agent:start', { agentName: 'synthesizer' });

      const reports = [compactScanReport(semgrepReport, MAX_SEMGREP_FINDINGS_FOR_SYNTHESIS), ...aiScannerRuns];
      const synthStart = Date.now();
      try {
        const synthRun = await new SynthesizerAgent().run(
          { scanReports: reports, totalFiles: allFiles.length, worktreePath: synthWT },
          this.policy,
          this.onChunk,
        );
        this.emit('agent:done', { agentName: 'synthesizer', durationMs: synthRun.durationMs });
        return { ...synthRun.output, totalFiles: allFiles.length };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit('agent:output', { agentName: 'synthesizer', text: `Synthesizer failed; using local fallback: ${message}\n` });
        this.emit('agent:done', { agentName: 'synthesizer', durationMs: Date.now() - synthStart });
        return fallbackAuditReport(reports, allFiles.length);
      }

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

  collectSourceFiles(target: string): string[] {
    return this.collectAuditStats(target).auditFiles;
  }

  collectAuditStats(target: string): AuditFileStats {
    const stats: AuditFileStats = {
      totalFiles: 0,
      auditFiles: [],
      ignoredDirs: 0,
      ignoredFiles: 0,
      oversizedFiles: 0,
      byExtension: {},
    };

    const root = pathJoin(this.cwd, target || '.');
    const rootRel = target && target !== '.' ? target.replace(/^[./]+/, '') : '';

    const walk = (dir: string, rel: string) => {
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }

      for (const entry of entries) {
        const fullPath = pathJoin(dir, entry);
        const relPath = rel ? `${rel}/${entry}` : entry;
        try {
          const st = statSync(fullPath);
          if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) {
            if (st.isDirectory()) stats.ignoredDirs++;
            else stats.ignoredFiles++;
            continue;
          }
          if (st.isDirectory()) {
            walk(fullPath, relPath);
            continue;
          }

          stats.totalFiles++;
          const ext = SOURCE_EXTS.find((candidate) => entry.endsWith(candidate));
          if (!ext) {
            stats.ignoredFiles++;
            continue;
          }
          stats.byExtension[ext] = (stats.byExtension[ext] ?? 0) + 1;

          if (IGNORE_PATTERNS.some((p) => p.test(relPath))) {
            stats.ignoredFiles++;
          } else if (st.size >= MAX_FILE_SIZE) {
            stats.oversizedFiles++;
          } else {
            stats.auditFiles.push(rootRel ? `${rootRel}/${relPath}` : relPath);
          }
        } catch { /* skip unreadable */ }
      }
    };

    walk(root, '');
    stats.auditFiles.sort();
    return stats;
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
