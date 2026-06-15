import type { AuditFinding, AuditReport, ScanReport } from '../schemas/audit.js';
import { SEVERITY_RANK } from '../schemas/audit.js';
import { validateAuditFindings } from '../infra/evidence-gate.js';
import { loadRepoIndex } from '../infra/repo-query.js';
import { detectProjectIdentity } from '../infra/project-identity.js';
import { reclassifyFindings, reclassStats, formatReclassNote } from '../infra/finding-reclassifier.js';
import type { PipelineEmitter } from './pipeline-context.js';

export const MAX_FINDING_TEXT = 220;
export const MAX_FINDINGS_PER_SCANNER = 10;
export const MAX_FINDINGS_FOR_SYNTHESIS = 8;
export const MAX_SEMGREP_FINDINGS_FOR_SYNTHESIS = 30;

export function compactText(text: string, max = MAX_FINDING_TEXT): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

export function compactFinding(finding: AuditFinding): AuditFinding {
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

export function recount(report: AuditReport): AuditReport {
  return {
    ...report,
    criticalCount: report.findings.filter((f) => f.severity === 'critical').length,
    highCount: report.findings.filter((f) => f.severity === 'high').length,
  };
}

export class FindingAggregator {
  constructor(
    private readonly cwd: string,
    private readonly emit: PipelineEmitter,
  ) {}

  deduplicate(findings: AuditFinding[]): AuditFinding[] {
    const seen = new Map<string, AuditFinding>();
    for (const f of findings) {
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

  applyContextReclassification(findings: AuditFinding[]): AuditFinding[] {
    try {
      const identity = detectProjectIdentity(this.cwd);
      const reclassed = reclassifyFindings(findings, identity);
      const stats = reclassStats(findings, reclassed);
      const note = formatReclassNote(stats);
      if (note) {
        this.emit('agent:output', { agentName: 'audit', text: `${note}\n` });
      }
      return reclassed;
    } catch {
      return findings;
    }
  }

  applyEvidenceGate(report: AuditReport): AuditReport {
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

  finalizeReport(
    gated: AuditReport,
    cachedFindings: AuditFinding[],
    totalFiles: number,
  ): AuditReport {
    const reclassed = this.applyContextReclassification(gated.findings);
    const deduped = this.deduplicate([...cachedFindings, ...reclassed]);
    return recount({ ...gated, findings: deduped, totalFiles });
  }
}
