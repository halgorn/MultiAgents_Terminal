import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AuditFinding, AuditReport } from '../schemas/audit.js';
import { saveDomainSnapshot, projectReportPath } from './project-report.js';
import {
  buildActionItems,
  buildFileHotspots,
  groupFindings,
  maxSeverity,
  markdownLocation,
  renderAiContext,
  renderDigest,
  type FullSavedAuditReport,
  type SavedAuditPaths,
  type CostSummary,
  type AuditHistoryEntry,
  SEVERITY_RANK,
} from './audit-model.js';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtUsd(n: number): string { return `$${n.toFixed(4)}`; }
function fmtDur(ms: number): string { return `${(ms / 1000).toFixed(1)}s`; }

function filterOptions(items: Array<[string, AuditFinding[]]>): string {
  return items.map(([key]) => `<option value="${esc(key)}">${esc(key)}</option>`).join('');
}

function statList(items: Array<[string, AuditFinding[]]>, label: string): string {
  return items.map(([key, findings]) => {
    const severity = maxSeverity(findings);
    return `<li><span>${esc(key)}</span><strong class="sev-text-${esc(severity)}">${findings.length}</strong><small>${esc(label)} · max ${esc(severity)}</small></li>`;
  }).join('');
}

function renderCostSection(cost: CostSummary | undefined, durationMs: number): string {
  if (!cost) return '';
  const rows = cost.perAgent.map((a) => `
    <tr>
      <td>${esc(a.name)}</td>
      <td>${esc(fmtUsd(a.costUsd))}</td>
      <td>${a.inputTokens.toLocaleString()}</td>
      <td>${a.outputTokens.toLocaleString()}</td>
    </tr>`).join('');
  return `
<section id="cost">
  <h2>Cost &amp; Performance</h2>
  <div class="cards">
    <div class="card"><div class="num">${esc(fmtUsd(cost.totalUsd))}</div><div class="muted">Total Cost</div></div>
    <div class="card"><div class="num">${cost.perAgent.length}</div><div class="muted">Agents</div></div>
    <div class="card"><div class="num">${esc(fmtDur(durationMs))}</div><div class="muted">Duration</div></div>
    <div class="card"><div class="num sev-text-medium">${esc(cost.model.replace('claude-', ''))}</div><div class="muted">Model</div></div>
  </div>
  ${rows ? `<table style="margin-top:14px"><thead><tr><th>Agent</th><th>Cost</th><th>Input Tokens</th><th>Output Tokens</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
</section>`;
}

function renderHistorySection(history: AuditHistoryEntry[], currentStamp: string): string {
  if (history.length === 0) return '';
  const reversed = history.slice().reverse();
  const rows = reversed.map((h, i) => {
    const isCurrent = h.stamp === currentStamp;
    const prev = reversed[i + 1];
    const critTrend = prev ? (h.criticalCount < prev.criticalCount ? '↓' : h.criticalCount > prev.criticalCount ? '↑' : '=') : '';
    const critClass = critTrend === '↓' ? 'sev-text-medium' : critTrend === '↑' ? 'sev-text-critical' : '';
    const link = isCurrent ? '<strong>current</strong>' : `<a href="../${esc(h.runRelDir)}/index.html">${new Date(h.createdAt).toLocaleString()}</a>`;
    return `<tr${isCurrent ? ' style="background:#161b22"' : ''}>
      <td>${link}</td>
      <td class="sev-text-critical">${h.criticalCount} <span class="${critClass}">${critTrend}</span></td>
      <td class="sev-text-high">${h.highCount}</td>
      <td>${h.totalFiles}</td>
      <td>${esc(fmtUsd(h.costUsd))}</td>
      <td class="muted">${esc(fmtDur(h.durationMs))}</td>
    </tr>`;
  }).join('');
  return `
<section id="history">
  <h2>Run History (${history.length} runs)</h2>
  <table><thead><tr><th>Run</th><th>Critical</th><th>High</th><th>Files</th><th>Cost</th><th>Duration</th></tr></thead>
  <tbody>${rows}</tbody></table>
</section>`;
}

function renderHtml(report: FullSavedAuditReport, history: AuditHistoryEntry[]): string {
  const actions = buildActionItems(report.findings);
  const hotspots = buildFileHotspots(report.findings);
  const byPersona = Object.entries(groupFindings(report.findings, (f) => f.persona ?? 'local')).sort((a, b) => b[1].length - a[1].length);
  const bySeverity = Object.entries(groupFindings(report.findings, (f) => f.severity)).sort((a, b) => (SEVERITY_RANK[b[0]] ?? 0) - (SEVERITY_RANK[a[0]] ?? 0));
  const byCategory = Object.entries(groupFindings(report.findings, (f) => f.category)).sort((a, b) => b[1].length - a[1].length);

  const actionCards = actions.map((item) => `
    <article class="card action" data-severity="${esc(item.severity)}" data-category="${esc(item.category)}">
      <div class="row"><span class="badge sev-${esc(item.severity)}">${esc(item.severity)}</span><span class="muted">#${item.id} · ${item.findings.length} findings · ${item.files.length} files</span></div>
      <h3>${esc(item.title)}</h3><p>${esc(item.recommendation)}</p>
      <details><summary>Evidence and files</summary>
        <ul>${item.files.map((file) => `<li><code>${esc(file.file)}${file.lines.length ? ':' + esc(file.lines.slice(0, 8).join(',')) : ''}</code></li>`).join('')}</ul>
        <ol>${item.findings.slice(0, 6).map((finding) => `<li><code>${esc(markdownLocation(finding))}</code> ${esc(finding.finding)}</li>`).join('')}</ol>
      </details>
    </article>`).join('');

  const sortedFindings = [...report.findings].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
  const rows = sortedFindings.map((f, idx) => `
    <tr data-severity="${esc(f.severity)}" data-category="${esc(f.category)}" data-persona="${esc(f.persona ?? 'local')}" data-file="${esc(f.file)}">
      <td class="muted" style="font-size:11px;width:30px">#${idx + 1}</td>
      <td><span class="badge sev-${esc(f.severity)}">${esc(f.severity)}</span></td><td>${esc(f.category)}</td><td>${esc(f.persona ?? 'local')}</td>
      <td><code>${esc(markdownLocation(f))}</code></td><td>${esc(f.finding)}<div class="recommendation">${esc(f.recommendation)}</div></td>
    </tr>`).join('');

  const sectionsByDomain = report.sections ?? [];

  const currentStamp = report.createdAt.replace(/[:.]/g, '-');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aion Audit · ${esc(new Date(report.createdAt).toLocaleDateString())}</title><style>
:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--blue:#79c0ff;--yellow:#e3b341;--red:#f85149;--green:#3fb950}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif}a{color:var(--blue)}code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.layout{display:grid;grid-template-columns:220px 1fr;min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;border-right:1px solid var(--line);background:#010409;padding:18px;overflow:auto}
.sidebar a{display:block;padding:5px 0;color:var(--muted);text-decoration:none;font-size:13px}.sidebar a:hover{color:var(--blue)}.sidebar .sep{border-top:1px solid var(--line);margin:10px 0}
main{padding:28px;max-width:1300px}.hero{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:22px}
h2{font-size:18px;margin:32px 0 12px;color:var(--blue);border-bottom:1px solid var(--line);padding-bottom:6px}h3{font-size:15px;margin:10px 0}
.muted,.meta{color:var(--muted);font-size:12px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}
.num{font-size:32px;font-weight:700}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.badge{display:inline-flex;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;text-transform:uppercase}
.sev-critical{background:#f8514920;color:var(--red)}.sev-high{background:#e3b34120;color:var(--yellow)}.sev-medium{background:#79c0ff20;color:var(--blue)}.sev-low,.sev-info{background:#8b949e20;color:var(--muted)}
.sev-text-critical{color:var(--red)}.sev-text-high{color:var(--yellow)}.sev-text-medium{color:var(--blue)}.sev-text-low,.sev-text-info,.sev-text-local{color:var(--muted)}.sev-text-green{color:var(--green)}
.action{margin-bottom:10px}details summary{cursor:pointer;color:var(--muted);font-size:12px;margin-top:6px}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.stats ul{list-style:none;margin:0;padding:0}.stats li{display:grid;grid-template-columns:1fr auto;gap:3px;border-bottom:1px solid #21262d;padding:8px 0}.stats small{grid-column:1/-1;color:var(--muted)}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.filters input,.filters select{background:#010409;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:6px;overflow:hidden}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #21262d;padding:9px}th{color:var(--muted);font-size:12px}
.recommendation{color:var(--muted);font-size:12px;margin-top:4px}.hotspots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.hotspot{display:grid;grid-template-columns:1fr auto;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px}
.domain-pill{display:inline-block;background:#21262d;border-radius:4px;padding:2px 7px;font-size:11px;margin:2px}
@media(max-width:900px){.layout{grid-template-columns:1fr}.sidebar{position:relative;height:auto}.cards,.stats,.hotspots{grid-template-columns:1fr}.hero{display:block}}
</style></head><body><div class="layout">
<nav class="sidebar">
  <h1 style="font-size:15px;margin:0 0 4px">Aion Audit</h1>
  <p class="muted" style="margin:0 0 12px;font-size:11px">${esc(new Date(report.createdAt).toLocaleString())}</p>
  <a href="../../index.html" style="color:var(--blue);font-size:12px">← Dashboard</a>
  <div class="sep"></div>
  <a href="#overview">Overview</a>
  <a href="#cost">Cost &amp; Performance</a>
  <a href="#actions">Action Plan</a>
  <a href="#findings">Findings</a>
  <a href="#personas">Personas</a>
  <a href="#files">File Hotspots</a>
  ${sectionsByDomain.length > 0 ? '<a href="#domain-breakdown">Domain Breakdown</a>' : ''}
  <a href="#history">History</a>
  <a href="#raw">Raw Data</a>
  <div class="sep"></div>
  <div class="muted" style="font-size:11px">${report.findings.length} findings · ${report.totalFiles} files</div>
</nav>
<main>

<section class="hero" id="overview">
  <div><h1>Audit Report</h1><p class="muted">${esc(report.summary)}</p></div>
  <div class="meta">Duration ${esc(fmtDur(report.durationMs))} · ${report.totalFiles} files · ${esc(new Date(report.createdAt).toLocaleString())}</div>
</section>
<section class="cards">
  <div class="card"><div class="num">${report.findings.length}</div><div class="muted">Findings</div></div>
  <div class="card"><div class="num sev-text-critical">${report.criticalCount}</div><div class="muted">Critical</div></div>
  <div class="card"><div class="num sev-text-high">${report.highCount}</div><div class="muted">High</div></div>
  <div class="card"><div class="num">${actions.length}</div><div class="muted">Actions</div></div>
</section>
<section><h2 style="border:none;padding:0;margin-top:18px">Top Priorities</h2><ol>${report.topPriorities.length ? report.topPriorities.map((p) => `<li>${esc(p)}</li>`).join('') : '<li>No top priorities.</li>'}</ol></section>

${renderCostSection(report.costSummary, report.durationMs)}

<section id="actions"><h2>Action Plan (${actions.length})</h2>${actionCards || '<p class="muted">No action items.</p>'}</section>

<section id="findings"><h2>Findings (${report.findings.length})</h2>
  <div class="filters">
    <input id="q" placeholder="Search findings, files, recommendations">
    <select id="severity"><option value="">All severities</option>${filterOptions(bySeverity)}</select>
    <select id="persona"><option value="">All personas</option>${filterOptions(byPersona)}</select>
    <select id="category"><option value="">All categories</option>${filterOptions(byCategory)}</select>
  </div>
  <table id="findingsTable"><thead><tr><th>#</th><th>Severity</th><th>Category</th><th>Persona</th><th>Location</th><th>Finding</th></tr></thead><tbody>${rows}</tbody></table>
</section>

<section id="personas"><h2>Personas &amp; Categories</h2>
  <div class="stats">
    <div class="card"><h3>By Persona</h3><ul>${statList(byPersona, 'persona')}</ul></div>
    <div class="card"><h3>By Severity</h3><ul>${statList(bySeverity, 'severity')}</ul></div>
    <div class="card"><h3>By Category</h3><ul>${statList(byCategory, 'category')}</ul></div>
  </div>
</section>

${sectionsByDomain.length > 0 ? `
<section id="domain-breakdown"><h2>Domain Breakdown</h2>
  ${sectionsByDomain.sort((a, b) => b.findings.length - a.findings.length).map((s) => {
    const crit = s.findings.filter((f) => f.severity === 'critical').length;
    const high = s.findings.filter((f) => f.severity === 'high').length;
    const badge = crit > 0 ? `<span class="badge sev-critical">${crit} critical</span>` : high > 0 ? `<span class="badge sev-high">${high} high</span>` : '';
    return `<details style="margin-bottom:8px;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:10px">
      <summary style="cursor:pointer;color:var(--text);font-weight:600">${esc(s.domain)} ${badge} <span class="muted">${s.findings.length} finding(s)</span></summary>
      <p class="muted" style="margin:8px 0">${esc(s.summary)}</p>
      <ul>${s.findings.slice(0, 10).map((f) => `<li><span class="badge sev-${esc(f.severity)}">${esc(f.severity)}</span> <code>${esc(markdownLocation(f))}</code> ${esc(f.finding)}</li>`).join('')}</ul>
    </details>`;
  }).join('')}
</section>` : ''}

<section id="files"><h2>File Hotspots</h2>
  <div class="hotspots">${hotspots.slice(0, 30).map((h) => `<div class="hotspot"><div><code>${esc(h.file)}</code><div style="margin-top:4px">${h.categories.map((c) => `<span class="domain-pill">${esc(c)}</span>`).join('')}</div></div><strong class="sev-text-${esc(h.maxSeverity)}">${h.findings}</strong></div>`).join('') || '<p class="muted">No hotspots.</p>'}</div>
</section>

${renderHistorySection(history, currentStamp)}

<section id="raw"><h2>Raw Data</h2>
  <ul><li><a href="digest.md">digest.md</a></li><li><a href="ai-context.md">ai-context.md</a></li><li><a href="report.json">report.json</a></li></ul>
</section>

</main></div>
<script>
const q=document.getElementById('q'),severity=document.getElementById('severity'),persona=document.getElementById('persona'),category=document.getElementById('category'),rows=Array.from(document.querySelectorAll('#findingsTable tbody tr'));
function applyFilters(){const text=q.value.toLowerCase();for(const row of rows){const okText=!text||row.textContent.toLowerCase().includes(text),okSeverity=!severity.value||row.dataset.severity===severity.value,okPersona=!persona.value||row.dataset.persona===persona.value,okCategory=!category.value||row.dataset.category===category.value;row.style.display=okText&&okSeverity&&okPersona&&okCategory?'':'none';}}
[q,severity,persona,category].forEach((el)=>el.addEventListener('input',applyFilters));
</script></body></html>`;
}

function renderDashboardHtml(history: AuditHistoryEntry[]): string {
  const sorted = history.slice().reverse();
  const latest = sorted[0];
  const rows = sorted.map((h, i) => {
    const prev = sorted[i + 1];
    const critChange = prev ? h.criticalCount - prev.criticalCount : 0;
    const critBadge = critChange > 0 ? `<span style="color:var(--red)">↑${critChange}</span>` : critChange < 0 ? `<span style="color:var(--green)">↓${Math.abs(critChange)}</span>` : '';
    return `<tr>
      <td><a href="${esc(h.runRelDir)}/index.html">${esc(new Date(h.createdAt).toLocaleString())}</a>${i === 0 ? ' <span class="badge sev-medium">latest</span>' : ''}</td>
      <td class="sev-text-critical">${h.criticalCount} ${critBadge}</td>
      <td class="sev-text-high">${h.highCount}</td>
      <td>${h.totalFiles}</td>
      <td>${esc(fmtUsd(h.costUsd))}</td>
      <td class="muted">${esc(fmtDur(h.durationMs))}</td>
    </tr>`;
  }).join('');

  const totalCost = history.reduce((s, h) => s + h.costUsd, 0);
  const avgCrit = history.length > 0 ? (history.reduce((s, h) => s + h.criticalCount, 0) / history.length).toFixed(1) : '0';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aion Audit Dashboard</title><style>
:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--blue:#79c0ff;--yellow:#e3b341;--red:#f85149;--green:#3fb950}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif;padding:28px}a{color:var(--blue)}code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
h1{font-size:22px;margin:0 0 6px}h2{font-size:16px;color:var(--blue);border-bottom:1px solid var(--line);padding-bottom:6px;margin:28px 0 12px}
.muted{color:var(--muted);font-size:12px}.badge{display:inline-flex;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;text-transform:uppercase}
.sev-medium{background:#79c0ff20;color:var(--blue)}.sev-critical{background:#f8514920;color:var(--red)}.sev-high{background:#e3b34120;color:var(--yellow)}
.sev-text-critical{color:var(--red)}.sev-text-high{color:var(--yellow)}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:28px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}
.num{font-size:28px;font-weight:700}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:6px;overflow:hidden}th,td{text-align:left;border-bottom:1px solid #21262d;padding:9px}th{color:var(--muted);font-size:12px}
</style></head><body>
<h1>Aion Audit Dashboard</h1>
<p class="muted">${history.length} run(s) · ${esc(new Date().toLocaleString())}</p>
${latest ? `<p>Latest: <a href="${esc(latest.runRelDir)}/index.html">${esc(new Date(latest.createdAt).toLocaleString())}</a> — <span class="sev-text-critical">${latest.criticalCount} critical</span>, <span class="sev-text-high">${latest.highCount} high</span></p>` : ''}
<div class="cards">
  <div class="card"><div class="num">${history.length}</div><div class="muted">Total Runs</div></div>
  <div class="card"><div class="num sev-text-critical">${latest?.criticalCount ?? 0}</div><div class="muted">Critical (latest)</div></div>
  <div class="card"><div class="num">${avgCrit}</div><div class="muted">Avg Critical</div></div>
  <div class="card"><div class="num">${esc(fmtUsd(totalCost))}</div><div class="muted">Total Spent</div></div>
</div>
<h2>All Runs</h2>
<table><thead><tr><th>Run</th><th>Critical</th><th>High</th><th>Files</th><th>Cost</th><th>Duration</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

function updateAuditHistory(reportsDir: string, entry: AuditHistoryEntry): AuditHistoryEntry[] {
  const historyFile = join(reportsDir, 'audit-history.json');
  let history: AuditHistoryEntry[] = [];
  if (existsSync(historyFile)) {
    try { history = JSON.parse(readFileSync(historyFile, 'utf8')) as AuditHistoryEntry[]; } catch { /* ignore */ }
  }
  history.push(entry);
  if (history.length > 50) history = history.slice(-50);
  writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf8');
  return history;
}

export function saveAuditReport(
  cwd: string,
  report: AuditReport,
  durationMs: number,
  aiContextBudget = 8000,
  costSummary?: CostSummary,
): SavedAuditPaths {
  const dir = join(cwd, '.ai-runtime', 'reports');
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const createdAt = now.toISOString();
  const fullReport: FullSavedAuditReport = { ...report, durationMs, createdAt, costSummary };
  const runDir = join(dir, 'audits', stamp);
  mkdirSync(runDir, { recursive: true });

  const paths: SavedAuditPaths = {
    runDir,
    html: join(runDir, 'index.html'),
    digest: join(runDir, 'digest.md'),
    aiContext: join(runDir, 'ai-context.md'),
    report: join(runDir, 'report.json'),
    dashboard: join(dir, 'index.html'),
    project: projectReportPath(cwd),
  };

  const history = updateAuditHistory(dir, {
    stamp,
    createdAt,
    runRelDir: `audits/${stamp}`,
    criticalCount: report.criticalCount,
    highCount: report.highCount,
    totalFiles: report.totalFiles,
    durationMs,
    costUsd: costSummary?.totalUsd ?? 0,
  });

  writeFileSync(paths.report, JSON.stringify(fullReport, null, 2), 'utf8');
  writeFileSync(paths.digest, renderDigest(fullReport), 'utf8');
  writeFileSync(paths.aiContext, renderAiContext(fullReport, aiContextBudget), 'utf8');
  writeFileSync(paths.html, renderHtml(fullReport, history), 'utf8');
  writeFileSync(join(dir, 'index.html'), renderDashboardHtml(history), 'utf8');
  saveDomainSnapshot(cwd, report);
  return { ...paths, project: projectReportPath(cwd) };
}
