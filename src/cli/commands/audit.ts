import type { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Orchestrator } from '../../core/orchestrator.js';
import { AuditPipeline } from '../../core/pipelines/audit-pipeline.js';
import { createRuntimePolicy } from '../../core/runtime-policy.js';
import { CostTracker } from '../../core/cost-tracker.js';
import { Renderer } from '../ui/renderer.js';
import type { AuditFinding } from '../../schemas/audit.js';

const SEVERITY_COLOR: Record<string, (s: string) => string> = {
  critical: chalk.bgRed.white.bold,
  high:     chalk.red.bold,
  medium:   chalk.yellow,
  low:      chalk.gray,
  info:     chalk.dim,
};

const SEVERITY_ICON: Record<string, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '⚪',
  info:     '🔵',
};

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

interface SavedAuditPaths {
  runDir: string;
  html: string;
  summary: string;
  actionPlan: string;
  report: string;
}

interface FullSavedAuditReport {
  findings: AuditFinding[];
  criticalCount: number;
  highCount: number;
  totalFiles: number;
  summary: string;
  topPriorities: string[];
  durationMs: number;
  createdAt: string;
}

interface ActionItem {
  id: number;
  title: string;
  severity: AuditFinding['severity'];
  category: string;
  personas: string[];
  files: Array<{ file: string; lines: number[] }>;
  findings: AuditFinding[];
  recommendation: string;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderAuditReport(report: {
  findings: AuditFinding[];
  criticalCount: number;
  highCount: number;
  totalFiles: number;
  summary: string;
  topPriorities: string[];
}, durationMs: number): void {
  console.log('\n' + chalk.bold('═'.repeat(60)));
  console.log(chalk.bold.cyan('  AUDIT REPORT') + chalk.gray(` — ${report.totalFiles} files — ${(durationMs / 1000).toFixed(1)}s`));
  console.log(chalk.bold('═'.repeat(60)));

  // Summary
  console.log('\n' + chalk.bold('Summary:'));
  console.log('  ' + report.summary);

  // Counts
  const counts = [
    report.criticalCount > 0 ? chalk.bgRed.white.bold(` ${report.criticalCount} critical `) : null,
    report.highCount > 0 ? chalk.red.bold(`${report.highCount} high`) : null,
    chalk.gray(`${report.findings.filter(f => f.severity === 'medium').length} medium`),
    chalk.gray(`${report.findings.filter(f => f.severity === 'low').length} low`),
  ].filter(Boolean);
  console.log('\n' + chalk.bold('Severity:') + '  ' + counts.join('  '));

  // Top priorities
  if (report.topPriorities.length > 0) {
    console.log('\n' + chalk.bold('Top Priorities:'));
    report.topPriorities.forEach((p, i) => {
      console.log(chalk.cyan(`  ${i + 1}.`) + ' ' + p);
    });
  }

  // Findings: if sections exist, render by domain; otherwise by severity
  const auditReport = report as import('../../schemas/audit.js').AuditReport;
  if (auditReport.sections && auditReport.sections.length > 0) {
    for (const section of auditReport.sections) {
      if (section.findings.length === 0) continue;
      console.log('\n' + chalk.bold.blue(`  ▸ ${section.domain.toUpperCase()} (${section.findings.length})`));
      for (const f of section.findings) {
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        const color = SEVERITY_COLOR[f.severity] ?? chalk.white;
        console.log(color(`  ${loc}`) + chalk.gray(` [${f.severity}]`));
        console.log(`    ${f.finding}`);
        console.log(chalk.dim(`    → ${f.recommendation}`));
        console.log();
      }
    }
  } else {
    const order = ['critical', 'high', 'medium', 'low', 'info'];
    for (const sev of order) {
      const group = report.findings.filter(f => f.severity === sev);
      if (group.length === 0) continue;
      const color = SEVERITY_COLOR[sev] ?? chalk.white;
      const icon = SEVERITY_ICON[sev] ?? '';
      console.log('\n' + color(` ${icon} ${sev.toUpperCase()} (${group.length}) `));
      for (const f of group) {
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        console.log(chalk.bold(`  ${loc}`) + chalk.gray(` [${f.category}]`));
        console.log(`    ${f.finding}`);
        console.log(chalk.dim(`    → ${f.recommendation}`));
        console.log();
      }
    }
  }

  console.log(chalk.bold('═'.repeat(60)));
}

function saveAuditReport(report: {
  findings: AuditFinding[];
  criticalCount: number;
  highCount: number;
  totalFiles: number;
  summary: string;
  topPriorities: string[];
}, durationMs: number): SavedAuditPaths {
  const dir = join(process.cwd(), '.ai-runtime', 'reports');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const createdAt = new Date().toISOString();
  const fullReport: FullSavedAuditReport = { ...report, durationMs, createdAt };
  const file = join(dir, `audit-${stamp}.json`);
  writeFileSync(file, JSON.stringify(fullReport, null, 2), 'utf8');

  const runDir = join(dir, 'audits', stamp);
  mkdirSync(runDir, { recursive: true });
  const html = join(runDir, 'index.html');
  const summary = join(runDir, 'summary.md');
  const actionPlan = join(runDir, 'action-plan.md');
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(fullReport, null, 2), 'utf8');
  writeFileSync(join(runDir, 'findings-by-persona.json'), JSON.stringify(groupFindings(report.findings, (f) => f.persona ?? 'local'), null, 2), 'utf8');
  writeFileSync(join(runDir, 'findings-by-severity.json'), JSON.stringify(groupFindings(report.findings, (f) => f.severity), null, 2), 'utf8');
  writeFileSync(join(runDir, 'findings-by-category.json'), JSON.stringify(groupFindings(report.findings, (f) => f.category), null, 2), 'utf8');
  writeFileSync(join(runDir, 'files-hotspots.json'), JSON.stringify(buildFileHotspots(report.findings), null, 2), 'utf8');
  writeFileSync(join(runDir, 'action-items.json'), JSON.stringify(buildActionItems(report.findings), null, 2), 'utf8');
  writeFileSync(join(runDir, 'README.md'), renderAuditIndex(fullReport), 'utf8');
  writeFileSync(summary, renderAuditSummary(fullReport), 'utf8');
  writeFileSync(actionPlan, renderActionPlan(fullReport), 'utf8');
  writeFileSync(html, renderAuditHtml(fullReport), 'utf8');
  writeFileSync(join(dir, 'latest-audit.json'), JSON.stringify({ report: file, runDir, html, summary, actionPlan, createdAt }, null, 2), 'utf8');
  return { runDir, html, summary, actionPlan, report: file };
}

function groupFindings(findings: AuditFinding[], keyFn: (finding: AuditFinding) => string): Record<string, AuditFinding[]> {
  const grouped: Record<string, AuditFinding[]> = {};
  for (const finding of findings) {
    const key = keyFn(finding);
    grouped[key] ??= [];
    grouped[key]!.push(finding);
  }
  return grouped;
}

function compact(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function maxSeverity(findings: AuditFinding[]): AuditFinding['severity'] {
  return findings
    .map((f) => f.severity)
    .sort((a, b) => (SEVERITY_RANK[b] ?? 0) - (SEVERITY_RANK[a] ?? 0))[0] ?? 'info';
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

function buildActionItems(findings: AuditFinding[]): ActionItem[] {
  return Object.values(groupFindings(findings, actionKey))
    .map((items) => {
      const files = Object.entries(
        items.reduce<Record<string, number[]>>((acc, finding) => {
          acc[finding.file] ??= [];
          if (typeof finding.line === 'number') acc[finding.file]!.push(finding.line);
          return acc;
        }, {}),
      ).map(([file, lines]) => ({ file, lines: [...new Set(lines)].sort((a, b) => a - b) }));

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

function buildFileHotspots(findings: AuditFinding[]): Array<{ file: string; findings: number; maxSeverity: string; categories: string[]; personas: string[] }> {
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

function markdownLocation(finding: AuditFinding): string {
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

function renderAuditSummary(report: FullSavedAuditReport): string {
  const actions = buildActionItems(report.findings).slice(0, 10);
  const hotspots = buildFileHotspots(report.findings).slice(0, 10);
  const lines: string[] = [
    '# Audit Summary',
    '',
    `Generated: ${report.createdAt}`,
    `Duration: ${(report.durationMs / 1000).toFixed(1)}s`,
    `Files covered by local scan: ${report.totalFiles}`,
    `Findings: ${report.findings.length}`,
    `Critical: ${report.criticalCount}`,
    `High: ${report.highCount}`,
    '',
    '## Summary',
    '',
    report.summary,
    '',
    '## Top Priorities',
    '',
    ...(report.topPriorities.length > 0 ? report.topPriorities.map((p, i) => `${i + 1}. ${p}`) : ['No top priorities.']),
    '',
    '## Consolidated Actions',
    '',
    ...(actions.length > 0 ? actions.map((item) => `${item.id}. [${item.severity}] ${item.title} (${item.files.length} file(s))`) : ['No action items.']),
    '',
    '## File Hotspots',
    '',
    ...(hotspots.length > 0 ? hotspots.map((h) => `- ${h.file}: ${h.findings} finding(s), max ${h.maxSeverity}`) : ['No file hotspots.']),
    '',
    '## Generated Files',
    '',
    '- `index.html`: navigable report',
    '- `action-plan.md`: consolidated remediation plan',
    '- `report.json`: raw machine-readable audit',
    '- `findings-by-persona.json`: findings grouped by persona',
    '- `findings-by-severity.json`: findings grouped by severity',
    '- `findings-by-category.json`: findings grouped by category',
  ];
  return lines.join('\n');
}

function renderActionPlan(report: FullSavedAuditReport): string {
  const actions = buildActionItems(report.findings);
  const lines: string[] = [
    '# Audit Action Plan',
    '',
    `Generated: ${report.createdAt}`,
    `Findings consolidated into ${actions.length} action item(s).`,
    '',
  ];

  if (actions.length === 0) {
    lines.push('No remediation actions were produced by this audit.');
    lines.push('');
    return lines.join('\n');
  }

  for (const item of actions) {
    lines.push(`## ${item.id}. [${item.severity.toUpperCase()}] ${item.title}`);
    lines.push('');
    lines.push(`Category: ${item.category}`);
    lines.push(`Personas: ${item.personas.join(', ') || 'local'}`);
    lines.push('');
    lines.push('Files:');
    for (const file of item.files) {
      const suffix = file.lines.length > 0 ? `:${file.lines.slice(0, 8).join(',')}` : '';
      lines.push(`- ${file.file}${suffix}`);
    }
    lines.push('');
    lines.push('Recommendation:');
    lines.push(item.recommendation);
    lines.push('');
    lines.push('Evidence:');
    for (const finding of item.findings.slice(0, 5)) {
      lines.push(`- ${markdownLocation(finding)}: ${finding.finding}`);
    }
    if (item.findings.length > 5) lines.push(`- ... ${item.findings.length - 5} more related finding(s)`);
    lines.push('');
  }

  return lines.join('\n');
}

function renderAuditHtml(report: FullSavedAuditReport): string {
  const actions = buildActionItems(report.findings);
  const hotspots = buildFileHotspots(report.findings);
  const byPersona = Object.entries(groupFindings(report.findings, (f) => f.persona ?? 'local'))
    .sort((a, b) => b[1].length - a[1].length);
  const bySeverity = Object.entries(groupFindings(report.findings, (f) => f.severity))
    .sort((a, b) => (SEVERITY_RANK[b[0]] ?? 0) - (SEVERITY_RANK[a[0]] ?? 0));
  const byCategory = Object.entries(groupFindings(report.findings, (f) => f.category))
    .sort((a, b) => b[1].length - a[1].length);

  const actionCards = actions.map((item) => `
    <article class="card action" data-severity="${esc(item.severity)}" data-category="${esc(item.category)}">
      <div class="row">
        <span class="badge sev-${esc(item.severity)}">${esc(item.severity)}</span>
        <span class="muted">#${item.id} · ${item.findings.length} finding(s) · ${item.files.length} file(s)</span>
      </div>
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.recommendation)}</p>
      <div class="meta">Category: ${esc(item.category)} · Personas: ${esc(item.personas.join(', ') || 'local')}</div>
      <details>
        <summary>Evidence and files</summary>
        <ul>
          ${item.files.map((file) => `<li><code>${esc(file.file)}${file.lines.length ? ':' + esc(file.lines.slice(0, 8).join(',')) : ''}</code></li>`).join('')}
        </ul>
        <ol>
          ${item.findings.slice(0, 6).map((finding) => `<li><code>${esc(markdownLocation(finding))}</code> ${esc(finding.finding)}</li>`).join('')}
        </ol>
      </details>
    </article>`).join('');

  const findingRows = report.findings.map((finding) => `
    <tr data-severity="${esc(finding.severity)}" data-category="${esc(finding.category)}" data-persona="${esc(finding.persona ?? 'local')}" data-file="${esc(finding.file)}">
      <td><span class="badge sev-${esc(finding.severity)}">${esc(finding.severity)}</span></td>
      <td>${esc(finding.category)}</td>
      <td>${esc(finding.persona ?? 'local')}</td>
      <td><code>${esc(markdownLocation(finding))}</code></td>
      <td>${esc(finding.finding)}<div class="recommendation">${esc(finding.recommendation)}</div></td>
    </tr>`).join('');

  const statList = (items: Array<[string, AuditFinding[]]>, label: string) => items.map(([key, findings]) => {
    const severity = maxSeverity(findings);
    return `<li><span>${esc(key)}</span><strong class="sev-text-${esc(severity)}">${findings.length}</strong><small>${esc(label)} · max ${esc(severity)}</small></li>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aion Audit Report</title>
<style>
  :root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--blue:#79c0ff;--green:#3fb950;--yellow:#e3b341;--red:#f85149;--gray:#6e7681}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  a{color:var(--blue);text-decoration:none}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#c9d1d9}
  .layout{display:grid;grid-template-columns:250px 1fr;min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;border-right:1px solid var(--line);background:#010409;padding:22px;overflow:auto}
  .sidebar h1{font-size:18px;margin:0 0 4px}.sidebar p{margin:0 0 18px;color:var(--muted);font-size:12px}.sidebar a{display:block;padding:7px 0;color:var(--muted)}.sidebar a:hover{color:var(--text)}
  main{padding:28px;max-width:1300px}.hero{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:22px}
  h2{font-size:20px;margin:34px 0 14px;color:var(--blue)}h3{font-size:15px;margin:10px 0}.muted,.meta{color:var(--muted);font-size:12px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}.num{font-size:32px;font-weight:700}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .badge{display:inline-flex;align-items:center;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;text-transform:uppercase}.sev-critical{background:#f8514920;color:var(--red)}.sev-high{background:#e3b34120;color:var(--yellow)}.sev-medium{background:#79c0ff20;color:var(--blue)}.sev-low{background:#8b949e20;color:var(--muted)}.sev-info{background:#6e768120;color:var(--gray)}
  .sev-text-critical{color:var(--red)}.sev-text-high{color:var(--yellow)}.sev-text-medium{color:var(--blue)}.sev-text-low,.sev-text-info{color:var(--muted)}
  .action{margin-bottom:12px}.action p{margin:6px 0 8px}.action details{margin-top:10px}.action summary{cursor:pointer;color:var(--blue)}
  .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.stats ul{list-style:none;margin:0;padding:0}.stats li{display:grid;grid-template-columns:1fr auto;gap:3px;border-bottom:1px solid #21262d;padding:8px 0}.stats small{grid-column:1/-1;color:var(--muted)}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.filters input,.filters select{background:#010409;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #21262d;padding:9px}th{color:var(--muted);font-size:12px}.recommendation{color:var(--muted);font-size:12px;margin-top:4px}
  .hotspots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.hotspot{display:grid;grid-template-columns:1fr auto;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px}
  @media (max-width:900px){.layout{grid-template-columns:1fr}.sidebar{position:relative;height:auto}.cards,.stats,.hotspots{grid-template-columns:1fr}.hero{display:block}}
</style>
</head>
<body>
<div class="layout">
  <nav class="sidebar">
    <h1>Aion Audit</h1>
    <p>${esc(report.createdAt)}</p>
    <a href="#overview">Overview</a>
    <a href="#actions">Action Plan</a>
    <a href="#findings">Findings</a>
    <a href="#personas">Personas</a>
    <a href="#files">Files</a>
    <a href="#raw">Raw Data</a>
  </nav>
  <main>
    <section class="hero" id="overview">
      <div>
        <h1>Audit Report</h1>
        <p class="muted">${esc(report.summary)}</p>
      </div>
      <div class="meta">Duration ${(report.durationMs / 1000).toFixed(1)}s · ${report.totalFiles} files covered</div>
    </section>
    <section class="cards">
      <div class="card"><div class="num">${report.findings.length}</div><div class="muted">Findings</div></div>
      <div class="card"><div class="num sev-text-critical">${report.criticalCount}</div><div class="muted">Critical</div></div>
      <div class="card"><div class="num sev-text-high">${report.highCount}</div><div class="muted">High</div></div>
      <div class="card"><div class="num">${actions.length}</div><div class="muted">Action items</div></div>
    </section>
    <section>
      <h2>Top Priorities</h2>
      <ol>${report.topPriorities.length ? report.topPriorities.map((p) => `<li>${esc(p)}</li>`).join('') : '<li>No top priorities.</li>'}</ol>
    </section>
    <section id="actions">
      <h2>Action Plan</h2>
      ${actionCards || '<p class="muted">No action items.</p>'}
    </section>
    <section id="findings">
      <h2>Findings</h2>
      <div class="filters">
        <input id="q" placeholder="Search findings, files, recommendations">
        <select id="severity"><option value="">All severities</option>${bySeverity.map(([s]) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
        <select id="persona"><option value="">All personas</option>${byPersona.map(([p]) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>
        <select id="category"><option value="">All categories</option>${byCategory.map(([c]) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      </div>
      <table id="findingsTable"><thead><tr><th>Severity</th><th>Category</th><th>Persona</th><th>Location</th><th>Finding</th></tr></thead><tbody>${findingRows}</tbody></table>
    </section>
    <section id="personas">
      <h2>Personas And Categories</h2>
      <div class="stats">
        <div class="card"><h3>By Persona</h3><ul>${statList(byPersona, 'persona')}</ul></div>
        <div class="card"><h3>By Severity</h3><ul>${statList(bySeverity, 'severity')}</ul></div>
        <div class="card"><h3>By Category</h3><ul>${statList(byCategory, 'category')}</ul></div>
      </div>
    </section>
    <section id="files">
      <h2>File Hotspots</h2>
      <div class="hotspots">${hotspots.slice(0, 30).map((h) => `<div class="hotspot"><code>${esc(h.file)}</code><strong class="sev-text-${esc(h.maxSeverity)}">${h.findings}</strong><small class="muted">${esc(h.categories.join(', '))}</small></div>`).join('') || '<p class="muted">No hotspots.</p>'}</div>
    </section>
    <section id="raw">
      <h2>Raw Data</h2>
      <ul>
        <li><a href="report.json">report.json</a></li>
        <li><a href="action-items.json">action-items.json</a></li>
        <li><a href="findings-by-persona.json">findings-by-persona.json</a></li>
        <li><a href="findings-by-severity.json">findings-by-severity.json</a></li>
        <li><a href="findings-by-category.json">findings-by-category.json</a></li>
        <li><a href="files-hotspots.json">files-hotspots.json</a></li>
      </ul>
    </section>
  </main>
</div>
<script>
const q = document.getElementById('q');
const severity = document.getElementById('severity');
const persona = document.getElementById('persona');
const category = document.getElementById('category');
const rows = Array.from(document.querySelectorAll('#findingsTable tbody tr'));
function applyFilters() {
  const text = q.value.toLowerCase();
  for (const row of rows) {
    const okText = !text || row.textContent.toLowerCase().includes(text);
    const okSeverity = !severity.value || row.dataset.severity === severity.value;
    const okPersona = !persona.value || row.dataset.persona === persona.value;
    const okCategory = !category.value || row.dataset.category === category.value;
    row.style.display = okText && okSeverity && okPersona && okCategory ? '' : 'none';
  }
}
[q, severity, persona, category].forEach((el) => el.addEventListener('input', applyFilters));
</script>
</body>
</html>`;
}

function renderAuditIndex(report: {
  findings: AuditFinding[];
  criticalCount: number;
  highCount: number;
  totalFiles: number;
  summary: string;
  topPriorities: string[];
  durationMs: number;
  createdAt: string;
}): string {
  const byPersona = Object.entries(groupFindings(report.findings, (f) => f.persona ?? 'local'))
    .sort((a, b) => b[1].length - a[1].length);
  const bySeverity = Object.entries(groupFindings(report.findings, (f) => f.severity))
    .sort((a, b) => b[1].length - a[1].length);

  const lines: string[] = [
    '# Audit Report',
    '',
    `- Created: ${report.createdAt}`,
    `- Duration: ${(report.durationMs / 1000).toFixed(1)}s`,
    `- Files covered by local scan: ${report.totalFiles}`,
    `- Findings: ${report.findings.length}`,
    `- Critical: ${report.criticalCount}`,
    `- High: ${report.highCount}`,
    '',
    '## Summary',
    '',
    report.summary,
    '',
    '## Top Priorities',
    '',
    ...report.topPriorities.map((priority, index) => `${index + 1}. ${priority}`),
    '',
    '## Findings By Persona',
    '',
    ...byPersona.map(([persona, findings]) => `- ${persona}: ${findings.length}`),
    '',
    '## Findings By Severity',
    '',
    ...bySeverity.map(([severity, findings]) => `- ${severity}: ${findings.length}`),
    '',
    '## Files',
    '',
    '- `report.json`: full machine-readable audit report',
    '- `findings-by-persona.json`: findings grouped by scanner persona',
    '- `findings-by-severity.json`: findings grouped by severity',
    '- `findings-by-category.json`: findings grouped by category',
    '',
  ];
  return lines.join('\n');
}

function renderDryRun(pipeline: AuditPipeline, stats: ReturnType<AuditPipeline['collectAuditStats']>, maxFilesForAi: number): void {
  console.log('\n' + chalk.bold.cyan('Audit dry run'));
  console.log(chalk.gray('No agents were started and no API tokens were used.'));
  console.log(`  total files seen: ${stats.totalFiles}`);
  console.log(`  audit source files: ${stats.auditFiles.length}`);
  console.log(`  AI target files: ${Math.min(stats.auditFiles.length, maxFilesForAi)} prioritized file(s)`);
  console.log(`  ignored directories: ${stats.ignoredDirs}`);
  console.log(`  ignored/non-source files: ${stats.ignoredFiles}`);
  console.log(`  oversized source files: ${stats.oversizedFiles}`);

  const exts = Object.entries(stats.byExtension).sort((a, b) => b[1] - a[1]);
  if (exts.length > 0) {
    console.log('\n' + chalk.bold('Extensions:'));
    exts.forEach(([ext, count]) => console.log(`  ${ext}: ${count}`));
  }

  if (stats.auditFiles.length > 0) {
    const prioritized = pipeline.prioritizeFiles(stats.auditFiles, maxFilesForAi);
    console.log('\n' + chalk.bold('AI target sample:'));
    prioritized.slice(0, 15).forEach((file) => console.log(`  ${file}`));
  }
}

export function registerAudit(program: Command): void {
  program
    .command('audit [target]')
    .description('Deep parallel audit: N scanners cover all files, synthesizer unifies findings')
    .option('-n, --scanners <n>', 'number of scanner agents (auto-selected if omitted)')
    .option('--budget <budget>', 'low | normal | deep (default: low)', 'low')
    .option('--provider <provider>', 'claude | openrouter (default: claude)')
    .option('--model <model>', 'model override for openrouter (e.g. moonshotai/kimi-k2)')
    .option('--preset <name>', 'persona preset: security, ai, backend, devops, quality, saas, fintech, full')
    .option('--domains <list>', 'comma-separated scanner domains, e.g. security,compliance,data')
    .option('--list-personas', 'show all available personas and presets then exit')
    .option('--local-only', 'run only deterministic local scans; no AI scanners or synthesizer')
    .option('--force-full', 'allow the full preset to start all requested AI scanner domains')
    .option('--max-files <n>', 'max prioritized source files sent to AI scanners (default: 30 low, 60 normal, 120 deep)')
    .option('--scanner-timeout <seconds>', 'timeout per AI scanner in seconds (default: 90 low, 150 normal, 240 deep)')
    .option('--fix', 'auto-fix critical/high findings after audit')
    .option('--fix-max <n>', 'max findings to auto-fix (default: 5)', '5')
    .option('--fix-min-severity <s>', 'minimum severity to fix: critical|high|medium (default: high)', 'high')
    .option('--dry-run', 'collect audit file stats without starting agents')
    .option('--incremental', 'only scan files changed since last audit (reuse cache for unchanged)')
    .action(async (target: string = '.', options: { scanners?: string; budget: string; provider?: string; model?: string; preset?: string; domains?: string; listPersonas?: boolean; localOnly?: boolean; forceFull?: boolean; maxFiles?: string; scannerTimeout?: string; fix?: boolean; fixMax: string; fixMinSeverity: string; dryRun?: boolean; incremental?: boolean }) => {
      if (options.listPersonas) {
        const { listPresets, BUILT_IN_PRESETS } = await import('../../infra/persona-presets.js');
        console.log(chalk.bold.cyan('\nPersonas (scanner domains):\n'));
        const allDomains = [
          'security','bugs','redundancy','error-handling','architecture','testing','performance',
          'infrastructure','observability','resilience','data','dependencies','compliance','multitenancy','prompt-audit',
        ];
        allDomains.forEach((d) => console.log(`  ${chalk.cyan(d)}`));
        listPresets();
        return;
      }

      // Merge .aionrc.json config under CLI options
      const { loadAionConfig, mergeConfig } = await import('../../infra/aion-config.js');
      const aionConfig = loadAionConfig(process.cwd());
      const mergedOptions = mergeConfig(options as Record<string, unknown>, aionConfig) as typeof options;

      const explicitN = mergedOptions.scanners ? Math.max(1, Math.min(15, parseInt(String(mergedOptions.scanners), 10) || 5)) : undefined;
      const budget = (['low', 'normal', 'deep'].includes(mergedOptions.budget) ? mergedOptions.budget : 'low') as 'low' | 'normal' | 'deep';
      const scannerTimeoutSeconds = mergedOptions.scannerTimeout
        ? Math.max(10, Math.min(600, parseInt(String(mergedOptions.scannerTimeout), 10) || 90))
        : budget === 'deep' ? 240 : budget === 'normal' ? 150 : 90;
      const maxFilesForAi = mergedOptions.maxFiles
        ? Math.max(1, Math.min(500, parseInt(String(mergedOptions.maxFiles), 10) || 30))
        : budget === 'deep' ? 120 : budget === 'normal' ? 60 : 30;
      const providerName = mergedOptions.provider === 'openrouter' ? 'openrouter' as const : undefined;
      const policyInput = {
        budget,
        ...(mergedOptions.model ? { openrouterModel: mergedOptions.model } : {}),
        ...(providerName ? {
          plannerProvider: providerName,
          investigatorProvider: providerName,
          developerProvider: providerName,
          reviewerProvider: providerName,
        } : {}),
      };
      const policy = createRuntimePolicy(policyInput);
      const renderer = new Renderer();
      const orch = new Orchestrator(process.cwd(), policyInput);

      if (options.dryRun) {
        const pipeline = new AuditPipeline(process.cwd(), policy, new CostTracker(), () => {}, () => {});
        renderDryRun(pipeline, pipeline.collectAuditStats(target), maxFilesForAi);
        return;
      }

      orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
      orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
      orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));

      // Resolve persona domains
      const { resolveDomainsFromConfig } = await import('../../infra/persona-presets.js');
      const { domains: explicitDomains, source: domainSource } = resolveDomainsFromConfig(
        process.cwd(), mergedOptions.preset, mergedOptions.domains, explicitN,
      );

      const maxAiScanners = explicitN ?? policy.maxAgents;
      const requestsFullPreset = (mergedOptions.preset === 'full' && explicitN === undefined) || explicitDomains.length > maxAiScanners;
      if (requestsFullPreset && !mergedOptions.forceFull && !mergedOptions.localOnly) {
        console.error(chalk.red.bold('\nRefusing expensive full audit by default.\n'));
        console.error(chalk.gray(`Requested ${explicitDomains.length} domains, but ${budget} budget allows ${maxAiScanners} AI scanner(s).`));
        console.error(chalk.gray('Use one of:'));
        console.error(`  ${chalk.cyan('aion audit . --local-only')}                    no AI tokens`);
        console.error(`  ${chalk.cyan(`aion audit . --preset ${mergedOptions.preset ?? 'security'} --scanners ${maxAiScanners}`)}   capped AI audit`);
        console.error(`  ${chalk.cyan('aion audit . --preset full --force-full')}      explicit full-cost run`);
        process.exitCode = 1;
        return;
      }

      const start = Date.now();
      const nLabel = mergedOptions.localOnly
        ? 'local-only scan (no AI tokens)'
        : explicitDomains.length > 0
        ? mergedOptions.localOnly
          ? `local-only scan [${domainSource}]`
          : `personas: ${explicitDomains.slice(0, maxAiScanners).join(', ')} [${domainSource}]`
        : explicitN ? `${explicitN} scanners` : `auto scanners (${budget} budget)`;
      console.log(chalk.bold.cyan(`\nStarting audit with ${nLabel}...\n`));

      try {
        const report = await orch.runAuditPipeline(
          target,
          explicitN,
          explicitDomains.length > 0 ? explicitDomains : undefined,
          {
            incremental: options.incremental,
            localOnly: mergedOptions.localOnly,
            maxAiScanners: mergedOptions.forceFull ? explicitDomains.length || explicitN : maxAiScanners,
            maxFilesForAi,
            scannerTimeoutMs: scannerTimeoutSeconds * 1000,
          },
        );
        const durationMs = Date.now() - start;
        renderAuditReport(report, durationMs);
        const saved = saveAuditReport(report, durationMs);
        console.log(chalk.gray(`report: ${saved.runDir}`));
        console.log(chalk.gray(`html: ${saved.html}`));
        console.log(chalk.gray(`summary: ${saved.summary}`));
        console.log(chalk.gray(`action plan: ${saved.actionPlan}`));
        console.log(chalk.dim(orch.costs.summary()));

        if (options.fix) {
          const maxFixes = Math.max(1, Math.min(20, parseInt(options.fixMax, 10) || 5));
          const minSev = (['critical', 'high', 'medium'].includes(options.fixMinSeverity)
            ? options.fixMinSeverity : 'high') as 'critical' | 'high' | 'medium';

          const eligible = report.findings
            .filter((f) => f.file && f.line && ((SEVERITY_RANK[f.severity] ?? 0) >= (SEVERITY_RANK[minSev] ?? 0)))
            .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
            .slice(0, maxFixes);

          if (options.dryRun) {
            // Dry-run: show what would be fixed without running
            console.log('\n' + chalk.bold.yellow(`Fix dry-run — ${eligible.length} finding(s) would be targeted (up to ${maxFixes}, severity ≥ ${minSev}):\n`));
            if (eligible.length === 0) {
              console.log(chalk.dim('  No eligible findings (need file+line and severity ≥ ' + minSev + ')'));
            } else {
              eligible.forEach((f, i) => {
                const loc = f.line ? `${f.file}:${f.line}` : f.file;
                const sev = SEVERITY_COLOR[f.severity]?.(f.severity) ?? chalk.white(f.severity);
                console.log(`  ${i + 1}. ${sev}  ${chalk.bold(loc)}`);
                console.log(`     ${f.finding}`);
                console.log(chalk.dim(`     → ${f.recommendation}`));
                console.log();
              });
            }
            const skipped = report.findings.length - eligible.length;
            if (skipped > 0) console.log(chalk.dim(`  ${skipped} finding(s) skipped (below threshold or missing file+line)`));
          } else if (report.criticalCount > 0 || report.highCount > 0 || minSev === 'medium') {
            console.log(chalk.bold.yellow(`\nAuto-fixing up to ${maxFixes} ${minSev}+ findings...\n`));
            const fixReport = await orch.runAuditFixPipeline(report, { maxFixes, minSeverity: minSev });
            console.log(chalk.bold(`Fix summary: ${fixReport.succeeded} fixed, ${fixReport.failed} failed, ${fixReport.skipped} skipped`));
          }
        }

        process.exit(report.criticalCount > 0 ? 2 : report.highCount > 0 ? 1 : 0);
      } catch (err) {
        renderer.showError(err);
        process.exit(1);
      }
    });
}
