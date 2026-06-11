import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { join as pathJoin } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { createWorktree, removeWorktree } from '../../infra/worktree.js';
import { ScannerAgent } from '../../agents/scanner.js';
import { SynthesizerAgent } from '../../agents/synthesizer.js';
import type { AuditFinding, AuditReport, ScanReport } from '../../schemas/audit.js';
import { SEVERITY_RANK } from '../../schemas/audit.js';
import { validateAuditFindings } from '../../infra/evidence-gate.js';
import { loadRepoIndex } from '../../infra/repo-query.js';
import { GraphAgent } from '../../agents/graph-agent.js';
import { buildDepGraphAuto } from '../../infra/dep-graph.js';
import { KnowledgeStore } from '../../infra/knowledge.js';

import { detectLang } from '../../infra/lang-detect.js';
import type { ScannerContext } from '../../prompts/scanner.js';
import type { RuntimePolicy } from '../runtime-policy.js';
import type { CostTracker } from '../cost-tracker.js';
import { SessionBudget } from '../cost-tracker.js';
import { loadAuditCache, saveAuditCache, filterChangedFiles, getCachedFindingsForFiles } from '../../infra/audit-cache.js';
import {
  collectAuditStats,
  prioritizeFiles,
  type AuditFileStats,
} from './audit-file-scanner.js';

type OnChunk = (agentName: string, text: string) => void;
type Emitter = (event: string, payload: unknown) => void;

const MAX_SEMGREP_FINDINGS_FOR_SYNTHESIS = 30;
const MAX_FINDINGS_PER_SCANNER = 10;
const MAX_FINDINGS_FOR_SYNTHESIS = 8;
const MAX_FINDING_TEXT = 220;

export { type AuditFileStats } from './audit-file-scanner.js';

export interface AuditRunOptions {
  incremental?: boolean;
  localOnly?: boolean;
  maxAiScanners?: number;
  maxFilesForAi?: number;
  scannerTimeoutMs?: number;
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
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 1) - (SEVERITY_RANK[a.severity] ?? 1))
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
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 1) - (SEVERITY_RANK[a.severity] ?? 1));

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

  private async buildScannerContext(domains?: import('../../prompts/scanner.js').ScanDomain[]): Promise<ScannerContext> {
    const ctx: ScannerContext = {};
    try {
      const graph = new GraphAgent(this.cwd);
      ctx.repoSummary = await graph.queryWithContext('architecture structure modules', 15, 3000);
    } catch { /* best-effort */ }
    try {
      const lang = detectLang(this.cwd);
      const dep = buildDepGraphAuto(this.cwd, lang.lang);
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
    try {
      const knowledge = new KnowledgeStore(this.cwd);
      if (knowledge.embeddings.hasIndex()) {
        const DOMAIN_QUERIES: Record<string, string> = {
          security: 'authentication authorization input validation token session credentials',
          bugs: 'null undefined error exception race condition off-by-one async await',
          'error-handling': 'try catch throw error exception promise rejection fallback',
          architecture: 'coupling dependency module interface abstraction design pattern',
          testing: 'test spec mock assert coverage unit integration',
          performance: 'cache query loop n+1 memory cpu latency bottleneck',
          observability: 'log trace metric event span instrumentation',
          resilience: 'timeout retry circuit breaker fallback rate limit',
          data: 'query database transaction index migration schema',
          dependencies: 'package import dependency version lock',
          compliance: 'gdpr lgpd pii personal data consent audit log',
          infrastructure: 'docker kubernetes container deploy config environment',
          multitenancy: 'tenant isolation scope filter permission row',
          redundancy: 'duplicate copy dead code unused unreachable',
          'prompt-audit': 'prompt llm injection template system message',
        };
        const query = (domains ?? [])
          .map((d) => DOMAIN_QUERIES[d] ?? d)
          .join(' ')
          || 'security bugs architecture error handling';
        ctx.ragContext = await knowledge.buildContextSemantic(query, 2000);
      }
    } catch { /* best-effort — RAG opcional */ }
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

  async run(
    target: string,
    numScanners?: number,
    explicitDomains?: import('../../prompts/scanner.js').ScanDomain[],
    options: AuditRunOptions = {},
  ): Promise<AuditReport> {
    const taskId = randomUUID();
    const worktrees: Array<[string, string]> = [];
    let synthDir: string | undefined;

    try {
      const stats = this.collectAuditStats(target);
      const allFiles = stats.auditFiles;
      if (allFiles.length === 0) {
        return { findings: [], criticalCount: 0, highCount: 0, totalFiles: 0, summary: 'No source files found.', topPriorities: [] };
      }

      // Incremental: skip unchanged files, reuse cached findings
      let filesToScan = allFiles;
      let cachedFindings: AuditFinding[] = [];
      if (options.incremental) {
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
        .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 1) - (SEVERITY_RANK[a.severity] ?? 1))
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
      } else {
        this.emit('agent:output', { agentName: 'audit', text: `Semgrep unavailable: ${semgrepResult.error ?? 'unknown error'}\n` });
      }

      if (options.localOnly) {
        const report = this.applyEvidenceGate(fallbackAuditReport([semgrepReport], allFiles.length));
        const finalReport = recount({
          ...report,
          summary: `${report.summary} Local-only mode: no AI scanners or synthesizer were started.`,
        });
        saveAuditCache(this.cwd, allFiles, finalReport.findings);
        return finalReport;
      }

      // Domain-based AI scanners (sequential to respect rate limits)
      const { SCAN_DOMAINS } = await import('../../prompts/scanner.js');
      const selectedDomains = explicitDomains && explicitDomains.length > 0
        ? explicitDomains
        : SCAN_DOMAINS.slice(0, resolvedScanners);
      const maxAiScanners = Math.max(1, options.maxAiScanners ?? this.policy.maxAgents);
      const domains = selectedDomains.slice(0, maxAiScanners);
      const n = domains.length;

      this.emit('agent:output', {
        agentName: 'audit',
        text: [
          `Found ${allFiles.length} source files → ${n} AI scanners (sequential, grep-first)`,
          selectedDomains.length > domains.length ? `Capped AI scanners from ${selectedDomains.length} to ${domains.length} by cost policy.` : '',
          `  ${domains.join(' | ')}`,
          '',
        ].filter(Boolean).join('\n'),
      });

      // Session budget gate — warn or reduce scanners before spending tokens
      const sessionBudget = new SessionBudget(this.cwd, this.policy.claudeMaxBudgetUsd);
      const budgetWarn = sessionBudget.warningLine();
      if (budgetWarn) this.emit('agent:output', { agentName: 'audit', text: `${budgetWarn}\n` });
      const estimated = sessionBudget.estimatedCost(domains.length, this.policy.claudeModel);
      if (!sessionBudget.canAfford(estimated)) {
        const affordable = Math.max(1, Math.floor(sessionBudget.remaining() / (estimated / domains.length)));
        domains.length = affordable;
        this.emit('agent:output', {
          agentName: 'audit',
          text: `⚠ Budget constraint: reduced scanners to ${domains.length} (estimated $${estimated.toFixed(2)}, $${sessionBudget.remaining().toFixed(2)} remaining)\n`,
        });
      }

      const scannerCtx = await this.buildScannerContext(explicitDomains);
      const maxFilesForAi = Math.max(1, options.maxFilesForAi ?? (
        this.policy.budget === 'deep' ? 120 : this.policy.budget === 'normal' ? 60 : 30
      ));
      const semgrepFileSet = new Set(semgrepResult.findings.map((f) => f.file ?? '').filter(Boolean));
      const aiTargetFiles = this.prioritizeFiles(filesToScan, maxFilesForAi, {
        semgrepFiles: semgrepFileSet,
        hotspotFiles: scannerCtx.hotspotFiles,
      });
      scannerCtx.targetFiles = aiTargetFiles;
      this.emit('agent:output', {
        agentName: 'audit',
        text: `AI file scope: ${aiTargetFiles.length}/${filesToScan.length} prioritized by risk (churn + deps + semgrep). Use --max-files to change.\n`,
      });

      const aiScannerRuns = await this.runSequential(
        domains.map((domain, i) => async () => {
          const wt = createWorktree(this.cwd, `scanner-${domain}`, taskId);
          worktrees.push([`scanner-${domain}`, taskId]);
          this.emit('agent:start', { agentName: `scanner-${domain}` });

          const start = Date.now();
          try {
            const run = await new ScannerAgent(domain, i, n, scannerCtx, this.policy.plannerProvider).run(
              { domain, worktreePath: wt, scannerIndex: i, totalScanners: n, context: scannerCtx },
              this.policy,
              this.onChunk,
            );
            this.emit('agent:done', { agentName: `scanner-${domain}`, durationMs: run.durationMs });
            const tagged = { ...run.output, findings: run.output.findings.map((f) => ({ ...f, persona: domain })) };
            return compactScanReport(tagged);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.emit('agent:output', { agentName: `scanner-${domain}`, text: `Scanner failed; continuing with partial audit: ${message}\n` });
            this.emit('agent:done', { agentName: `scanner-${domain}`, durationMs: Date.now() - start });
            return { filesScanned: [], findings: [], summary: `Scanner ${domain} failed: ${compactText(message, 500)}` };
          }
        }),
        options.scannerTimeoutMs,
        (err, idx) => {
          const domain = domains[idx] ?? 'unknown';
          this.emit('agent:output', { agentName: `scanner-${domain}`, text: `Scanner timed out; skipping: ${err.message}\n` });
          this.emit('agent:done', { agentName: `scanner-${domain}`, durationMs: options.scannerTimeoutMs ?? 360000 });
          return { filesScanned: [], findings: [], summary: `Scanner ${domain} timed out` };
        },
      );

      // Synthesize — use a temp dir (no git worktree needed, synthesizer reads no files)
      synthDir = mkdtempSync(pathJoin(tmpdir(), 'aion-synth-'));
      this.emit('agent:start', { agentName: 'synthesizer' });

      const reports = [
        compactScanReport(semgrepReport, MAX_SEMGREP_FINDINGS_FOR_SYNTHESIS),
        ...aiScannerRuns.map((r) => compactScanReport(r, MAX_FINDINGS_FOR_SYNTHESIS)),
      ];
      const synthStart = Date.now();
      try {
        const synthRun = await new SynthesizerAgent(this.policy.plannerProvider).run(
          { scanReports: reports, totalFiles: allFiles.length, worktreePath: synthDir },
          this.policy,
          this.onChunk,
        );
        this.emit('agent:done', { agentName: 'synthesizer', durationMs: synthRun.durationMs });
        const gated = this.applyEvidenceGate({ ...synthRun.output, totalFiles: allFiles.length });
        const deduped = this.deduplicateFindings([...cachedFindings, ...gated.findings]);
        const finalReport = recount({ ...gated, findings: deduped });
        saveAuditCache(this.cwd, allFiles, finalReport.findings);
        sessionBudget.record(this.costs.totalUsd());
        return finalReport;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit('agent:output', { agentName: 'synthesizer', text: `Synthesizer failed; using local fallback: ${message}\n` });
        this.emit('agent:done', { agentName: 'synthesizer', durationMs: Date.now() - synthStart });
        const fallback = this.applyEvidenceGate(fallbackAuditReport(reports, allFiles.length));
        const deduped = this.deduplicateFindings([...cachedFindings, ...fallback.findings]);
        const finalReport = recount({ ...fallback, findings: deduped });
        saveAuditCache(this.cwd, allFiles, finalReport.findings);
        sessionBudget.record(this.costs.totalUsd());
        return finalReport;
      }

    } finally {
      for (const [agentName, taskId_] of worktrees) {
        try { removeWorktree(this.cwd, agentName, taskId_); } catch { /* best-effort */ }
      }
      if (synthDir) {
        try { rmSync(synthDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    }
  }

  private async runSequential<T>(
    tasks: Array<() => Promise<T>>,
    timeoutMs = 6 * 60 * 1000,
    onError?: (err: Error, index: number) => T,
  ): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < tasks.length; i++) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Scanner timed out after ${timeoutMs / 1000}s`)), timeoutMs);
      });
      try {
        results.push(await Promise.race([tasks[i]!(), timeout]));
      } catch (err) {
        if (onError) {
          results.push(onError(err instanceof Error ? err : new Error(String(err)), i));
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return results;
  }

  private deduplicateFindings(findings: AuditFinding[]): AuditFinding[] {
    const seen = new Map<string, AuditFinding>();
    for (const f of findings) {
      // Key by precise location when available; include text for null-line findings
      // so distinct file-level issues are not collapsed.
      const lineKey = f.line ?? `file:${f.finding.slice(0, 80)}`;
      const key = `${f.file}:${lineKey}:${f.category}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, f);
      } else {
        const keepNew = (SEVERITY_RANK[f.severity] ?? 1) > (SEVERITY_RANK[existing.severity] ?? 1);
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
    return [...seen.values()].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 1) - (SEVERITY_RANK[a.severity] ?? 1));
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
    return collectAuditStats(this.cwd, target).auditFiles;
  }

  collectAuditStats(target: string): AuditFileStats {
    return collectAuditStats(this.cwd, target);
  }

  prioritizeFiles(
    files: string[],
    max: number,
    extra?: { semgrepFiles?: Set<string>; hotspotFiles?: string[] },
  ): string[] {
    return prioritizeFiles(this.cwd, files, max, extra);
  }
}
