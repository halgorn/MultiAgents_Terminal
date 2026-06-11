import { BaseAgent } from './base-agent.js';
import { buildSynthesizerPrompt } from '../prompts/synthesizer.js';
import { z } from 'zod';
import { type AuditFinding, type AuditReport, type ScanReport, type DomainSection, SEVERITY_RANK, SEVERITY_ORDER } from '../schemas/audit.js';
import type { TaskState } from '../core/state-machine.js';
import type { ProviderName } from '../core/runtime-policy.js';

export interface SynthesizerInput {
  scanReports: ScanReport[];
  totalFiles: number;
  worktreePath: string;
}

const MIN_PER_DOMAIN = 2;

// Compact schema — Claude only writes summary + topPriorities
const SynthOutputSchema = z.object({
  summary: z.string(),
  topPriorities: z.array(z.string()),
});

// ── Local helpers ─────────────────────────────────────────────────────────────

function deduplicateAndRank(scanReports: ScanReport[]): AuditFinding[] {
  const seen = new Map<string, AuditFinding>();

  for (const report of scanReports) {
    for (const f of report.findings) {
      const key = `${f.file}:${f.line ?? ''}:${f.category}`;
      const existing = seen.get(key);
      if (!existing || (SEVERITY_RANK[f.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) {
        seen.set(key, existing
          ? { ...f, persona: [existing.persona, f.persona].filter(Boolean).join('+') }
          : f,
        );
      }
    }
  }

  return [...seen.values()].sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
  );
}

function ensurePerDomainCoverage(deduped: AuditFinding[], scanReports: ScanReport[]): AuditFinding[] {
  const dedupedKeys = new Set(deduped.map((f) => `${f.file}:${f.line ?? ''}:${f.category}`));
  const extras: AuditFinding[] = [];

  for (const report of scanReports) {
    const domain = report.findings[0]?.category;
    if (!domain) continue;
    const inDeduped = deduped.filter((f) => f.category === domain).length;
    if (inDeduped >= MIN_PER_DOMAIN) continue;

    const needed = MIN_PER_DOMAIN - inDeduped;
    const candidates = report.findings
      .filter((f) => !dedupedKeys.has(`${f.file}:${f.line ?? ''}:${f.category}`))
      .slice(0, needed);
    extras.push(...candidates);
    candidates.forEach((f) => dedupedKeys.add(`${f.file}:${f.line ?? ''}:${f.category}`));
  }

  return extras;
}

function buildDomainSections(findings: AuditFinding[]): DomainSection[] {
  const byDomain = new Map<string, AuditFinding[]>();
  for (const f of findings) {
    if (!byDomain.has(f.category)) byDomain.set(f.category, []);
    byDomain.get(f.category)!.push(f);
  }
  return [...byDomain.entries()].map(([domain, domainFindings]) => ({
    domain,
    findings: domainFindings.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)),
    summary: `${domainFindings.length} finding(s) in ${domain}`,
  }));
}

// Build a compact text digest — much smaller than raw JSON.
// Claude only reads this to write summary + topPriorities.
function buildCompactDigest(findings: AuditFinding[], totalFiles: number, domainSections: DomainSection[]): string {
  const lines: string[] = [
    `## Audit Digest: ${findings.length} findings across ${domainSections.length} domains (${totalFiles} files scanned)`,
    '',
  ];

  for (const sev of SEVERITY_ORDER) {
    const group = findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    lines.push(`${sev.toUpperCase()} (${group.length}):`);
    for (const f of group.slice(0, 12)) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`- [${f.category}] ${loc} — ${f.finding.slice(0, 120)}`);
    }
    if (group.length > 12) lines.push(`  ... ${group.length - 12} more`);
    lines.push('');
  }

  lines.push('Domain coverage:');
  for (const s of domainSections) {
    const bySev = SEVERITY_ORDER.map((sv) => {
      const n = s.findings.filter((f) => f.severity === sv).length;
      return n > 0 ? `${n} ${sv}` : null;
    }).filter(Boolean).join(', ');
    lines.push(`- ${s.domain}: ${s.findings.length} (${bySev || 'none'})`);
  }

  return lines.join('\n');
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class SynthesizerAgent extends BaseAgent<SynthesizerInput, AuditReport> {
  private mergedFindings: AuditFinding[] = [];
  private domainSections: DomainSection[] = [];
  private totalFiles = 0;

  constructor(provider: ProviderName = 'claude') {
    super({
      name: 'synthesizer',
      provider,
      systemPrompt: buildSynthesizerPrompt(),
    });
  }

  protected getWorktreePath(input: SynthesizerInput): string {
    return input.worktreePath;
  }

  protected buildUserMessage(input: SynthesizerInput): string {
    // All heavy work is done locally here before calling Claude.
    const deduped = deduplicateAndRank(input.scanReports);
    const extras = ensurePerDomainCoverage(deduped, input.scanReports);
    const allFindings = [...deduped, ...extras].sort(
      (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
    );

    this.mergedFindings = allFindings;
    this.domainSections = buildDomainSections(allFindings);
    this.totalFiles = input.totalFiles;

    return buildCompactDigest(allFindings, input.totalFiles, this.domainSections) + `

Write the summary and topPriorities for this audit. Output ONLY valid JSON:
{ "summary": "...", "topPriorities": ["...", "...", "...", "...", "..."] }`;
  }

  protected parseOutput(text: string): AuditReport {
    const raw = this.parseJson<unknown>(text, 'SynthesizerAgent');
    const result = SynthOutputSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`SynthesizerAgent schema error: ${result.error.message}`);
    }

    return {
      findings: this.mergedFindings,
      criticalCount: this.mergedFindings.filter((f) => f.severity === 'critical').length,
      highCount: this.mergedFindings.filter((f) => f.severity === 'high').length,
      totalFiles: this.totalFiles,
      summary: result.data.summary,
      topPriorities: result.data.topPriorities,
      sections: this.domainSections,
    };
  }

  protected resolveState(_output: AuditReport): TaskState {
    return 'DONE';
  }
}
