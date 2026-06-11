import type { AuditReport, AuditFinding, FixSeverity } from '../../schemas/audit.js';
import { SEVERITY_RANK } from '../../schemas/audit.js';
import type { TaskResult } from '../task.js';
import type { PipelineContext } from '../pipeline-context.js';
import { runFixPipeline } from './fix-pipeline.js';

export interface AuditFixOptions {
  maxFixes?: number;
  minSeverity?: FixSeverity;
  dryRun?: boolean;
}

export interface AuditFixResult {
  finding: AuditFinding;
  result: TaskResult | null;
  skipped: boolean;
  skipReason?: string;
}

export interface AuditFixReport {
  totalFindings: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: AuditFixResult[];
}

function severityMeetsMin(severity: string, min: string): boolean {
  return (SEVERITY_RANK[severity] ?? 0) >= (SEVERITY_RANK[min] ?? 0);
}

function buildFixTarget(finding: AuditFinding): string {
  const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
  return `[${finding.severity}] ${finding.category} in ${loc}: ${finding.finding}. Fix: ${finding.recommendation}`;
}

export async function runAuditFixPipeline(
  ctx: PipelineContext,
  auditReport: AuditReport,
  options: AuditFixOptions = {},
): Promise<AuditFixReport> {
  const {
    maxFixes = 5,
    minSeverity = 'high',
    dryRun = false,
  } = options;

  // Filter and rank findings eligible for auto-fix
  const eligible = auditReport.findings
    .filter((f) => f.file && f.line && severityMeetsMin(f.severity, minSeverity))
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
    .slice(0, maxFixes);

  const results: AuditFixResult[] = [];
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const finding of eligible) {
    if (dryRun) {
      results.push({ finding, result: null, skipped: true, skipReason: 'dry-run' });
      skipped++;
      continue;
    }

    attempted++;
    ctx.emit('agent:output', {
      agentName: 'audit-fix',
      text: `\nFixing [${finding.severity}] ${finding.file}:${finding.line} — ${finding.finding.slice(0, 80)}\n`,
    });

    try {
      const target = buildFixTarget(finding);
      const result = await runFixPipeline(ctx, target);

      if (result.state === 'DONE') {
        succeeded++;
        results.push({ finding, result, skipped: false });
      } else {
        failed++;
        results.push({ finding, result, skipped: false });
      }
    } catch (err) {
      failed++;
      results.push({
        finding,
        result: null,
        skipped: false,
        skipReason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Findings that didn't meet criteria go as skipped
  const ineligible = auditReport.findings
    .filter((f) => !eligible.includes(f))
    .map((finding) => ({
      finding,
      result: null,
      skipped: true,
      skipReason: severityMeetsMin(finding.severity, minSeverity)
        ? 'no file+line evidence'
        : `severity ${finding.severity} below threshold ${minSeverity}`,
    }));

  skipped += ineligible.length;
  results.push(...ineligible);

  return {
    totalFindings: auditReport.findings.length,
    attempted,
    succeeded,
    failed,
    skipped,
    results,
  };
}
