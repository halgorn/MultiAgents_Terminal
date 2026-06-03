import { BaseAgent } from './base-agent.js';
import { buildSynthesizerPrompt } from '../prompts/synthesizer.js';
import { AuditReportSchema, type AuditReport, type AuditFinding, type ScanReport, type DomainSection } from '../schemas/audit.js';
import type { TaskState } from '../core/state-machine.js';

export interface SynthesizerInput {
  scanReports: ScanReport[];
  totalFiles: number;
  worktreePath: string;
}

const MIN_PER_DOMAIN = 2;

function buildDomainSections(scanReports: ScanReport[]): DomainSection[] {
  const byDomain = new Map<string, AuditFinding[]>();
  for (const report of scanReports) {
    for (const finding of report.findings) {
      const d = finding.category;
      if (!byDomain.has(d)) byDomain.set(d, []);
      byDomain.get(d)!.push(finding);
    }
  }
  return [...byDomain.entries()].map(([domain, findings]) => ({
    domain,
    findings: findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    summary: `${findings.length} finding(s) in ${domain}`,
  }));
}

function severityRank(s: string): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[s] ?? 0;
}

function guaranteePerDomain(reports: ScanReport[], merged: AuditFinding[]): AuditFinding[] {
  const mergedKeys = new Set(merged.map((f) => `${f.file}:${f.line}:${f.finding}`));
  const extras: AuditFinding[] = [];

  for (const report of reports) {
    const domain = report.findings[0]?.category;
    if (!domain) continue;
    const inMerged = merged.filter((f) => f.category === domain).length;
    if (inMerged >= MIN_PER_DOMAIN) continue;

    const needed = MIN_PER_DOMAIN - inMerged;
    const candidates = report.findings
      .filter((f) => !mergedKeys.has(`${f.file}:${f.line}:${f.finding}`))
      .slice(0, needed);
    extras.push(...candidates);
    candidates.forEach((f) => mergedKeys.add(`${f.file}:${f.line}:${f.finding}`));
  }

  return extras;
}

export class SynthesizerAgent extends BaseAgent<SynthesizerInput, AuditReport> {
  constructor() {
    super({
      name: 'synthesizer',
      provider: 'claude',
      systemPrompt: buildSynthesizerPrompt(),
    });
  }

  protected getWorktreePath(input: SynthesizerInput): string {
    return input.worktreePath;
  }

  protected buildUserMessage(input: SynthesizerInput): string {
    const parts = input.scanReports.map((r, i) => {
      const header = `=== Scanner ${i + 1} (${r.findings[0]?.category ?? 'unknown'}) ===`;
      const findingsCompact = r.findings.map((f) => JSON.stringify(f)).join('\n');
      return `${header}\nSummary: ${r.summary}\nFindings:\n${findingsCompact}`;
    });

    return `Total files: ${input.totalFiles} | Scanners: ${input.scanReports.length}

${parts.join('\n\n')}

Rules:
- Include AT LEAST ${MIN_PER_DOMAIN} findings per scanner domain regardless of severity
- Merge duplicates (same file+line), keep the more descriptive finding
- Rank overall by severity but preserve domain diversity in topPriorities
- topPriorities must include at least one entry per domain that has critical/high findings

Merge, deduplicate, rank by severity, and output the unified audit report JSON.`;
  }

  protected parseOutput(text: string): AuditReport {
    const raw = this.parseJson<unknown>(text, 'SynthesizerAgent');
    const result = AuditReportSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`SynthesizerAgent schema error: ${result.error.message}`);
    }

    const report = result.data;

    // Post-process: guarantee per-domain representation and add sections
    const extras = guaranteePerDomain([], report.findings);
    const allFindings = [...report.findings, ...extras];
    const sections = buildDomainSections(
      report.sections
        ? report.sections.map((s) => ({ filesScanned: [], findings: s.findings, summary: s.summary }))
        : [{ filesScanned: [], findings: allFindings, summary: '' }],
    );

    return {
      ...report,
      findings: allFindings,
      sections,
      criticalCount: allFindings.filter((f) => f.severity === 'critical').length,
      highCount: allFindings.filter((f) => f.severity === 'high').length,
    };
  }

  protected resolveState(_output: AuditReport): TaskState {
    return 'DONE';
  }
}
