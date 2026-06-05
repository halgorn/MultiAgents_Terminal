import type { AuditFinding, DomainSection } from '../schemas/audit.js';

export const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export interface CostSummary {
  totalUsd: number;
  model: string;
  perAgent: Array<{ name: string; costUsd: number; inputTokens: number; outputTokens: number }>;
}

export interface AuditHistoryEntry {
  stamp: string;
  createdAt: string;
  runRelDir: string;
  criticalCount: number;
  highCount: number;
  totalFiles: number;
  durationMs: number;
  costUsd: number;
}

export interface FullSavedAuditReport {
  findings: AuditFinding[];
  criticalCount: number;
  highCount: number;
  totalFiles: number;
  summary: string;
  topPriorities: string[];
  durationMs: number;
  createdAt: string;
  sections?: DomainSection[];
  costSummary?: CostSummary;
}

export interface SavedAuditPaths {
  runDir: string;
  html: string;
  digest: string;
  aiContext: string;
  report: string;
  dashboard: string;
}

export interface ActionItem {
  id: number;
  title: string;
  severity: AuditFinding['severity'];
  category: string;
  personas: string[];
  files: Array<{ file: string; lines: number[] }>;
  findings: AuditFinding[];
  recommendation: string;
}

export interface FileHotspot {
  file: string;
  findings: number;
  maxSeverity: string;
  categories: string[];
  personas: string[];
}

export function groupFindings(findings: AuditFinding[], keyFn: (finding: AuditFinding) => string): Record<string, AuditFinding[]> {
  const grouped: Record<string, AuditFinding[]> = {};
  for (const finding of findings) {
    const key = keyFn(finding);
    grouped[key] ??= [];
    grouped[key]!.push(finding);
  }
  return grouped;
}

export function compact(value: string, max = 120): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export function maxSeverity(findings: AuditFinding[]): AuditFinding['severity'] {
  return findings
    .map((f) => f.severity)
    .sort((a, b) => (SEVERITY_RANK[b] ?? 0) - (SEVERITY_RANK[a] ?? 0))[0] ?? 'info';
}

export function markdownLocation(finding: AuditFinding): string {
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

function actionKey(finding: AuditFinding): string {
  const normalized = finding.finding
    .toLowerCase()
    .replace(/src\/[^\s:]+(:\d+)?/g, '')
    .replace(/\d+/g, '#')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 90);
  return `${finding.category}:${normalized}`;
}

export function buildActionItems(findings: AuditFinding[]): ActionItem[] {
  return Object.values(groupFindings(findings, actionKey))
    .map((items) => {
      const files = Object.entries(
        items.reduce<Record<string, number[]>>((acc, finding) => {
          acc[finding.file] ??= [];
          if (typeof finding.line === 'number') acc[finding.file]!.push(finding.line);
          return acc;
        }, {}),
      ).map(([file, lines]) => ({ file, lines: uniqueSorted(lines.map(String)).map(Number).sort((a, b) => a - b) }));
      const severity = maxSeverity(items);
      return {
        id: 0,
        title: compact(items[0]?.finding ?? 'Review finding', 90),
        severity,
        category: items[0]?.category ?? 'maintainability',
        personas: uniqueSorted(items.map((f) => f.persona ?? 'local')),
        files,
        findings: items.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)),
        recommendation: compact(items[0]?.recommendation ?? 'Review and remediate.', 220),
      };
    })
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || b.findings.length - a.findings.length)
    .map((item, index) => ({ ...item, id: index + 1 }));
}

export function buildFileHotspots(findings: AuditFinding[]): FileHotspot[] {
  return Object.entries(groupFindings(findings, (f) => f.file))
    .map(([file, items]) => ({
      file,
      findings: items.length,
      maxSeverity: maxSeverity(items),
      categories: uniqueSorted(items.map((f) => f.category)),
      personas: uniqueSorted(items.map((f) => f.persona ?? 'local')),
    }))
    .sort((a, b) => (SEVERITY_RANK[b.maxSeverity] ?? 0) - (SEVERITY_RANK[a.maxSeverity] ?? 0) || b.findings - a.findings);
}


export function renderDigest(report: FullSavedAuditReport): string {
  const actions = buildActionItems(report.findings);
  const hotspots = buildFileHotspots(report.findings).slice(0, 12);
  const lines = [
    '# Audit Digest',
    '',
    `Generated: ${report.createdAt}`,
    `Files covered: ${report.totalFiles}`,
    `Findings: ${report.findings.length} (${report.criticalCount} critical, ${report.highCount} high)`,
    '',
    '## Executive Summary',
    report.summary,
    '',
    '## Top Priorities',
    ...(report.topPriorities.length ? report.topPriorities.map((p, i) => `${i + 1}. ${p}`) : ['No top priorities.']),
    '',
    '## Hotspot Files',
    ...(hotspots.length ? hotspots.map((h) => `- ${h.file}: ${h.findings} finding(s), max ${h.maxSeverity}`) : ['No hotspots.']),
    '',
    '## Action Plan',
    `${actions.length} action item(s).`,
    '',
  ];
  for (const item of actions) {
    lines.push(`### ${item.id}. [${item.severity.toUpperCase()}] ${item.title}`, '');
    lines.push(`Category: ${item.category} · Personas: ${item.personas.join(', ') || 'local'}`, '');
    lines.push('Files:', ...item.files.map((f) => `- ${f.file}${f.lines.length ? ':' + f.lines.slice(0, 8).join(',') : ''}`), '');
    lines.push('Recommendation:', item.recommendation, '');
    for (const finding of item.findings.slice(0, 5)) lines.push(`- ${markdownLocation(finding)}: ${finding.finding}`);
    if (item.findings.length > 5) lines.push(`- ... ${item.findings.length - 5} more`);
    lines.push('');
  }
  if (actions.length === 0) lines.push('No remediation actions.', '');
  return lines.join('\n');
}

export function renderAiContext(report: FullSavedAuditReport, budgetTokens = 8000): string {
  const budgetChars = Math.max(2000, budgetTokens * 4);
  const actions = buildActionItems(report.findings);
  const lines = [
    '# Compact Audit Context For AI',
    '',
    'Use this compact report instead of sending raw audit JSON or all source files.',
    '',
    `Files covered: ${report.totalFiles}`,
    `Findings: ${report.findings.length}; critical: ${report.criticalCount}; high: ${report.highCount}`,
    '',
    '## Summary',
    report.summary,
    '',
    '## Consolidated Root Causes / Actions',
  ];
  for (const item of actions) {
    lines.push(`- [${item.severity}] ${item.title}`);
    lines.push(`  Category: ${item.category}; personas: ${item.personas.join(', ') || 'local'}`);
    lines.push(`  Files: ${item.files.slice(0, 8).map((f) => f.file).join(', ')}`);
    lines.push(`  Fix: ${item.recommendation}`);
  }
  lines.push('', '## Highest-Signal Evidence');
  for (const f of report.findings.slice(0, 40)) {
    lines.push(`- ${f.severity} ${markdownLocation(f)} [${f.category}] ${compact(f.finding, 180)}`);
  }
  const text = lines.join('\n');
  return text.length > budgetChars ? `${text.slice(0, budgetChars)}\n\n[truncated to ~${budgetTokens} tokens]` : text;
}
