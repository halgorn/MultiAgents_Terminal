import { randomUUID } from 'crypto';
import { readdirSync, statSync } from 'fs';
import { join as pathJoin } from 'path';
import { createWorktree, removeWorktree } from '../../infra/worktree.js';
import { ScannerAgent } from '../../agents/scanner.js';
import { SynthesizerAgent } from '../../agents/synthesizer.js';
import type { AuditFinding, AuditReport, ScanReport } from '../../schemas/audit.js';
import { validateAuditFindings } from '../../infra/evidence-gate.js';
import { loadRepoIndex } from '../../infra/repo-query.js';
import { GraphAgent } from '../../agents/graph-agent.js';
import { buildDepGraph } from '../../infra/dep-graph.js';
import { buildPythonDepGraph } from '../../infra/dep-graph-python.js';
import { detectLang } from '../../infra/lang-detect.js';
import type { ScannerContext } from '../../prompts/scanner.js';
import type { RuntimePolicy } from '../runtime-policy.js';
import type { CostTracker } from '../cost-tracker.js';
import { loadAuditCache, saveAuditCache, filterChangedFiles, getCachedFindingsForFiles } from '../../infra/audit-cache.js';
import { loadIgnorePatterns, isIgnored } from '../../infra/aion-ignore.js';

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
const MAX_FINDINGS_PER_SCANNER = 10;
const MAX_FINDINGS_FOR_SYNTHESIS = 8;
const MAX_FINDING_TEXT = 220;

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

function recount(report: AuditReport): AuditReport {
  return {
    ...report,
    criticalCount: report.findings.filter((f) => f.severity === 'critical').length,
    highCount: report.findings.filter((f) => f.severity === 'high').length,
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

  private async buildScannerContext(): Promise<ScannerContext> {
    const ctx: ScannerContext = {};
    try {
      const graph = new GraphAgent(this.cwd);
      ctx.repoSummary = await graph.queryWithContext('architecture structure modules', 15, 3000);
    } catch { /* best-effort */ }
    try {
      const lang = detectLang(this.cwd);
      const dep = lang.lang === 'python'
        ? buildPythonDepGraph(this.cwd)
        : buildDepGraph(this.cwd);
      const lines: string[] = [];
      if (dep.cycles.length > 0) {
        lines.push(`Cycles (${dep.cycles.length}): ${dep.cycles.slice(0, 5).map((c) => c.join(' → ')).join('; ')}`);
      }
      const hotspots = dep.hotspots.slice(0, 10);
      if (hotspots.length > 0) {
        lines.push(`Hotspots: ${hotspots.map((h) => `${h.file} (in:${h.fanIn} out:${h.fanOut})`).join(', ')}`);
        ctx.hotspotFiles = hotspots.map((h) => h.file);
      }
      if (lines.length > 0) ctx.depGraph = lines.join('\n');
    } catch { /* best-effort */ }
    return ctx;
  }

  autoSelectScanners(totalFiles: number): number {
    const budget = this.policy.budget;
    if (budget === 'deep') return 7;
    if (budget === 'normal') return totalFiles > 500 ? 5 : 4;
    // low: scale with repo size
    if (totalFiles > 1000) return 5;
    if (totalFiles > 300) return 4;
    if (totalFiles > 100) return 3;
    return 2;
  }

  async run(target: string, numScanners?: number, explicitDomains?: import('../../prompts/scanner.js').ScanDomain[], incremental = false): Promise<AuditReport> {
    const taskId = randomUUID();
    const worktrees: Array<[string, string]> = [];

    try {
      const stats = this.collectAuditStats(target);
      const allFiles = stats.auditFiles;
      if (allFiles.length === 0) {
        return { findings: [], criticalCount: 0, highCount: 0, totalFiles: 0, summary: 'No source files found.', topPriorities: [] };
      }

      // Incremental: skip unchanged files, reuse cached findings
      let filesToScan = allFiles;
      let cachedFindings: AuditFinding[] = [];
      if (incremental) {
        const cache = loadAuditCache(this.cwd);
        const { changed, unchanged } = filterChangedFiles(this.cwd, allFiles, cache);
        if (cache && unchanged.length > 0) {
          filesToScan = changed;
          cachedFindings = getCachedFindingsForFiles(cache, unchanged) as AuditFinding[];
          this.emit('agent:output', {
            agentName: 'audit',
            text: `Incremental mode: ${changed.length} changed files to scan, ${unchanged.length} unchanged (reusing cache)\n`,
          });
        }
        if (filesToScan.length === 0) {
          const report = this.applyEvidenceGate({ findings: cachedFindings, criticalCount: 0, highCount: 0, totalFiles: allFiles.length, summary: 'Incremental: no changed files. All findings from cache.', topPriorities: [] });
          saveAuditCache(this.cwd, allFiles, report.findings);
          return report;
        }
      }

      const resolvedScanners = numScanners ?? this.autoSelectScanners(allFiles.length);

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
      const domains = explicitDomains && explicitDomains.length > 0
        ? explicitDomains
        : SCAN_DOMAINS.slice(0, resolvedScanners);
      const n = domains.length;

      this.emit('agent:output', {
        agentName: 'audit',
        text: `Found ${allFiles.length} source files → ${n} AI scanners (sequential, grep-first)\n  ${domains.join(' | ')}\n`,
      });

      const scannerCtx = await this.buildScannerContext();

      const aiScannerRuns = await this.runSequential(
        domains.map((domain, i) => async () => {
          const wt = createWorktree(this.cwd, `scanner-${domain}`, taskId);
          worktrees.push([`scanner-${domain}`, taskId]);
          this.emit('agent:start', { agentName: `scanner-${domain}` });

          const start = Date.now();
          try {
            const run = await new ScannerAgent(domain, i, n, scannerCtx).run(
              { domain, worktreePath: wt, scannerIndex: i, totalScanners: n, context: scannerCtx },
              this.policy,
              this.onChunk,
            );
            this.emit('agent:done', { agentName: `scanner-${domain}`, durationMs: run.durationMs });
            // Tag each finding with the persona that found it
            const tagged = { ...run.output, findings: run.output.findings.map((f) => ({ ...f, persona: domain })) };
            return compactScanReport(tagged);
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

      const reports = [
        compactScanReport(semgrepReport, MAX_SEMGREP_FINDINGS_FOR_SYNTHESIS),
        ...aiScannerRuns.map((r) => compactScanReport(r, MAX_FINDINGS_FOR_SYNTHESIS)),
      ];
      const synthStart = Date.now();
      try {
        const synthRun = await new SynthesizerAgent().run(
          { scanReports: reports, totalFiles: allFiles.length, worktreePath: synthWT },
          this.policy,
          this.onChunk,
        );
        this.emit('agent:done', { agentName: 'synthesizer', durationMs: synthRun.durationMs });
        const gated = this.applyEvidenceGate({ ...synthRun.output, totalFiles: allFiles.length });
        const deduped = this.deduplicateFindings([...cachedFindings, ...gated.findings]);
        const finalReport = recount({ ...gated, findings: deduped });
        saveAuditCache(this.cwd, allFiles, finalReport.findings);
        return finalReport;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit('agent:output', { agentName: 'synthesizer', text: `Synthesizer failed; using local fallback: ${message}\n` });
        this.emit('agent:done', { agentName: 'synthesizer', durationMs: Date.now() - synthStart });
        const fallback = this.applyEvidenceGate(fallbackAuditReport(reports, allFiles.length));
        const deduped = this.deduplicateFindings([...cachedFindings, ...fallback.findings]);
        const finalReport = recount({ ...fallback, findings: deduped });
        saveAuditCache(this.cwd, allFiles, finalReport.findings);
        return finalReport;
      }

    } finally {
      for (const [agentName, taskId_] of worktrees) {
        try { removeWorktree(this.cwd, agentName, taskId_); } catch { /* best-effort */ }
      }
    }
  }

  private async runSequential<T>(tasks: Array<() => Promise<T>>, timeoutMs = 6 * 60 * 1000): Promise<T[]> {
    const results: T[] = [];
    for (const task of tasks) {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Scanner timed out after ${timeoutMs / 1000}s`)), timeoutMs),
      );
      results.push(await Promise.race([task(), timeout]));
    }
    return results;
  }

  private deduplicateFindings(findings: AuditFinding[]): AuditFinding[] {
    const seen = new Map<string, AuditFinding>();
    for (const f of findings) {
      // Key: file + line + category (not finding text — same issue found by multiple personas)
      const key = `${f.file}:${f.line ?? ''}:${f.category}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, f);
      } else {
        const keepNew = severityRank(f.severity) > severityRank(existing.severity);
        const merged = keepNew ? f : existing;
        const otherPersona = keepNew ? existing.persona : f.persona;
        seen.set(key, {
          ...merged,
          persona: merged.persona && otherPersona
            ? `${merged.persona}+${otherPersona}`
            : merged.persona ?? otherPersona,
        });
      }
    }
    return [...seen.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  }

  private applyEvidenceGate(report: AuditReport): AuditReport {
    const result = validateAuditFindings(report.findings, loadRepoIndex(this.cwd));
    if (result.rejected.length === 0) return recount(report);

    this.emit('agent:output', {
      agentName: 'evidence-gate',
      text: `Rejected ${result.rejected.length} findings without deterministic file/line evidence.\n`,
    });

    return recount({
      ...report,
      findings: result.accepted,
      summary: `${report.summary} Evidence gate rejected ${result.rejected.length} findings without deterministic file/line evidence.`,
      topPriorities: result.accepted.slice(0, 5).map((f) => `${f.severity}: ${f.file}${f.line ? `:${f.line}` : ''} — ${f.finding}`),
    });
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

    const ignorePatterns = loadIgnorePatterns(this.cwd);
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

          if (IGNORE_PATTERNS.some((p) => p.test(relPath)) || isIgnored(relPath, ignorePatterns)) {
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
