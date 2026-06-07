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

const AUDIT_HTML_CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{--bg:#101419;--surface:#1c2025;--surface-low:#181c21;--surface-high:#272a30;--surface-highest:#32353b;--line:#414752;--text:#e0e2ea;--muted:#8b919d;--dim:#c0c7d4;--primary:#a2c9ff;--primary-btn:#58a6ff;--primary-on:#00315c;--critical:#ffb4ab;--high:#ffba42;--green:#3fb950}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:14px;line-height:1.5}
a{color:var(--primary);text-decoration:none}code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px}button{cursor:pointer}
.ms{font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;vertical-align:middle;user-select:none}
.header{position:fixed;top:0;left:0;width:100%;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:0 24px;height:64px;border-bottom:1px solid var(--line);background:rgba(16,20,25,.85);backdrop-filter:blur(12px)}
.brand{font-size:22px;font-weight:900;color:var(--primary);letter-spacing:-.02em}
.sidebar{position:fixed;left:0;top:0;height:100%;width:240px;display:flex;flex-direction:column;padding:80px 16px 16px;background:var(--surface-low);border-right:1px solid var(--line);z-index:40;overflow-y:auto}
.sidebar a{display:flex;align-items:center;gap:8px;padding:7px 10px;color:var(--muted);font-size:13px;font-family:'JetBrains Mono',monospace;border-radius:8px;transition:all .15s}
.sidebar a:hover{color:var(--text);background:var(--surface-high)}.sep{border-top:1px solid var(--line);margin:10px 0}
.main{margin-left:240px;padding:88px 24px 24px;display:flex;flex-direction:column;gap:28px}
.bento{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:14px}
.bento-hero{background:var(--surface-low);border:1px solid var(--line);border-radius:16px;padding:22px;position:relative;overflow:hidden}
.bento-hero::before{content:'';position:absolute;top:-64px;right:-64px;width:200px;height:200px;background:rgba(162,201,255,.04);border-radius:50%;filter:blur(48px)}
.bento-hero h1{margin:0;font-size:22px;font-weight:900;color:var(--text);position:relative;z-index:1}
.bento-hero p{margin:6px 0 0;font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;position:relative;z-index:1}
.stat-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;justify-content:space-between}
.stat-label{font-size:10px;font-family:'JetBrains Mono',monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.stat-num{font-size:30px;font-weight:700;color:var(--text);margin-top:12px}
.stat-num.crit{color:var(--critical)}.stat-num.high{color:var(--high)}
section-h{font-size:17px;font-weight:700;color:var(--primary);border-bottom:1px solid var(--line);padding-bottom:8px;margin:0 0 14px}
h2{font-size:17px;font-weight:700;color:var(--primary);border-bottom:1px solid var(--line);padding-bottom:8px;margin:0 0 14px}h3{font-size:14px;margin:8px 0}
.pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700}
.pill-crit{background:rgba(255,180,171,.12);color:var(--critical);border:1px solid rgba(255,180,171,.3)}
.pill-high{background:rgba(255,186,66,.12);color:var(--high);border:1px solid rgba(255,186,66,.3)}
.pill-med{background:rgba(162,201,255,.12);color:var(--primary);border:1px solid rgba(162,201,255,.3)}
.pill-low,.pill-info{background:rgba(139,145,157,.15);color:var(--muted);border:1px solid rgba(139,145,157,.2)}
.action-card{background:var(--surface-low);border:1px solid var(--line);border-radius:12px;padding:14px;position:relative;margin-bottom:10px;transition:border-color .15s}
.action-card:hover{border-color:var(--muted)}
.action-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:12px 0 0 12px}
.action-card.ac-critical::before{background:var(--critical)}.action-card.ac-high::before{background:var(--high)}.action-card.ac-medium::before{background:var(--primary)}.action-card.ac-low::before,.action-card.ac-info::before{background:var(--muted)}
.action-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.action-card h3{margin:4px 0 6px;font-size:15px;font-weight:600;color:var(--text)}
.action-card p{margin:0 0 8px;font-size:13px;color:var(--dim)}
details summary{cursor:pointer;color:var(--muted);font-size:12px;margin-top:6px;font-family:'JetBrains Mono',monospace}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.filters input,.filters select{background:var(--surface-low);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px}
.filters input:focus,.filters select:focus{outline:1px solid var(--primary)}
table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--surface-high);padding:9px 10px}th{color:var(--muted);font-size:12px;font-family:'JetBrains Mono',monospace}
.rec{color:var(--muted);font-size:12px;margin-top:4px}
.hotspots{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.hotspot{background:var(--surface-low);border:1px solid var(--line);border-radius:10px;padding:10px;display:grid;grid-template-columns:1fr auto;gap:4px;align-items:start}
.domain-pill{display:inline-block;background:var(--surface-high);border-radius:4px;padding:2px 7px;font-size:11px;margin:2px;font-family:'JetBrains Mono',monospace}
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.stat-ul{list-style:none;margin:0;padding:0}.stat-li{display:grid;grid-template-columns:1fr auto;gap:3px;border-bottom:1px solid var(--surface-high);padding:7px 0}.stat-li small{grid-column:1/-1;color:var(--muted);font-size:11px}
.sidebar-footer{margin-top:auto;padding-top:12px;border-top:1px solid var(--line)}
.sidebar-footer-lbl{font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace;padding:4px 10px}
@media(max-width:900px){.sidebar{display:none}.main{margin-left:0}.bento{grid-template-columns:1fr 1fr}.bento-hero{grid-column:span 2}.hotspots,.stat-grid{grid-template-columns:1fr}}
`;

function renderHtml(report: FullSavedAuditReport, history: AuditHistoryEntry[]): string {
  const actions = buildActionItems(report.findings);
  const hotspots = buildFileHotspots(report.findings);
  const byPersona = Object.entries(groupFindings(report.findings, (f) => f.persona ?? 'local')).sort((a, b) => b[1].length - a[1].length);
  const bySeverity = Object.entries(groupFindings(report.findings, (f) => f.severity)).sort((a, b) => (SEVERITY_RANK[b[0]] ?? 0) - (SEVERITY_RANK[a[0]] ?? 0));
  const byCategory = Object.entries(groupFindings(report.findings, (f) => f.category)).sort((a, b) => b[1].length - a[1].length);
  const sectionsByDomain = report.sections ?? [];
  const currentStamp = report.createdAt.replace(/[:.]/g, '-');
  const dateStr = new Date(report.createdAt).toLocaleString('pt-BR');

  const pillClass = (sev: string) => ({ critical: 'pill-crit', high: 'pill-high', medium: 'pill-med', low: 'pill-low', info: 'pill-info' }[sev] ?? 'pill-low');

  const actionCards = actions.map((item) => `
<article class="action-card ac-${esc(item.severity)}" data-severity="${esc(item.severity)}" data-category="${esc(item.category)}">
  <div class="action-meta">
    <span class="pill ${pillClass(item.severity)}">${esc(item.severity.toUpperCase())}</span>
    <span style="color:var(--muted);font-size:12px;font-family:'JetBrains Mono',monospace">#${item.id} · ${item.findings.length} findings · ${item.files.length} files</span>
  </div>
  <h3>${esc(item.title)}</h3>
  <p>${esc(item.recommendation)}</p>
  <details><summary>Evidence and files</summary>
    <ul style="font-size:12px;margin:6px 0">${item.files.map((file) => `<li><code>${esc(file.file)}${file.lines.length ? ':' + esc(file.lines.slice(0, 8).join(',')) : ''}</code></li>`).join('')}</ul>
    <ol style="font-size:12px">${item.findings.slice(0, 6).map((finding) => `<li><code>${esc(markdownLocation(finding))}</code> ${esc(finding.finding)}</li>`).join('')}</ol>
  </details>
</article>`).join('');

  const sortedFindings = [...report.findings].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
  const rows = sortedFindings.map((f, idx) => `
<tr data-severity="${esc(f.severity)}" data-category="${esc(f.category)}" data-persona="${esc(f.persona ?? 'local')}" data-file="${esc(f.file ?? '')}">
  <td style="font-size:11px;width:28px;color:var(--muted)">#${idx + 1}</td>
  <td><span class="pill ${pillClass(f.severity)}">${esc(f.severity)}</span></td>
  <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${esc(f.category)}</td>
  <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${esc(f.persona ?? 'local')}</td>
  <td><code>${esc(markdownLocation(f))}</code></td>
  <td>${esc(f.finding)}<div class="rec">${esc(f.recommendation)}</div></td>
</tr>`).join('');

  const statRows = (items: Array<[string, AuditFinding[]]>, label: string) => items.map(([key, findings]) => {
    const sev = maxSeverity(findings);
    return `<li class="stat-li"><span style="font-family:'JetBrains Mono',monospace;font-size:13px">${esc(key)}</span><strong class="${['critical','high'].includes(sev) ? 'pill ' + pillClass(sev) : ''}" style="font-size:13px">${findings.length}</strong><small>${esc(label)} · max ${esc(sev)}</small></li>`;
  }).join('');

  const costSection = !report.costSummary ? '' : `
<section id="cost">
  <h2>Cost &amp; Performance</h2>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
    <div class="stat-card"><span class="stat-label">Total Cost</span><div class="stat-num">${esc(fmtUsd(report.costSummary.totalUsd))}</div></div>
    <div class="stat-card"><span class="stat-label">Agents</span><div class="stat-num">${report.costSummary.perAgent.length}</div></div>
    <div class="stat-card"><span class="stat-label">Duration</span><div class="stat-num">${esc(fmtDur(report.durationMs))}</div></div>
    <div class="stat-card"><span class="stat-label">Model</span><div class="stat-num" style="font-size:14px;margin-top:16px;font-family:'JetBrains Mono',monospace">${esc(report.costSummary.model.replace('claude-', ''))}</div></div>
  </div>
  ${report.costSummary.perAgent.length ? `<table><thead><tr><th>Agent</th><th>Cost</th><th>Input Tokens</th><th>Output Tokens</th></tr></thead><tbody>${report.costSummary.perAgent.map((a) => `<tr><td style="font-family:'JetBrains Mono',monospace">${esc(a.name)}</td><td>${esc(fmtUsd(a.costUsd))}</td><td>${a.inputTokens.toLocaleString()}</td><td>${a.outputTokens.toLocaleString()}</td></tr>`).join('')}</tbody></table>` : ''}
</section>`;

  const historySection = history.length === 0 ? '' : (() => {
    const reversed = history.slice().reverse();
    const histRows = reversed.map((h, i) => {
      const isCurrent = h.stamp === currentStamp;
      const prev = reversed[i + 1];
      const critTrend = prev ? (h.criticalCount < prev.criticalCount ? '↓' : h.criticalCount > prev.criticalCount ? '↑' : '=') : '';
      const trendColor = critTrend === '↓' ? 'var(--green)' : critTrend === '↑' ? 'var(--critical)' : 'var(--muted)';
      const link = isCurrent ? '<strong>current</strong>' : `<a href="../${esc(h.runRelDir)}/index.html">${new Date(h.createdAt).toLocaleString('pt-BR')}</a>`;
      return `<tr${isCurrent ? ' style="background:rgba(162,201,255,.05)"' : ''}><td>${link}</td><td style="color:var(--critical)">${h.criticalCount} <span style="color:${trendColor}">${critTrend}</span></td><td style="color:var(--high)">${h.highCount}</td><td>${h.totalFiles}</td><td>${esc(fmtUsd(h.costUsd))}</td><td style="color:var(--muted)">${esc(fmtDur(h.durationMs))}</td></tr>`;
    }).join('');
    return `<section id="history"><h2>Run History (${history.length} runs)</h2><table><thead><tr><th>Run</th><th>Critical</th><th>High</th><th>Files</th><th>Cost</th><th>Duration</th></tr></thead><tbody>${histRows}</tbody></table></section>`;
  })();

  const domainSection = sectionsByDomain.length === 0 ? '' : `
<section id="domain-breakdown"><h2>Domain Breakdown</h2>
${sectionsByDomain.sort((a, b) => b.findings.length - a.findings.length).map((s) => {
    const crit = s.findings.filter((f) => f.severity === 'critical').length;
    const high = s.findings.filter((f) => f.severity === 'high').length;
    const badge = crit > 0 ? `<span class="pill pill-crit">${crit} critical</span>` : high > 0 ? `<span class="pill pill-high">${high} high</span>` : '';
    return `<details style="margin-bottom:8px;background:var(--surface-low);border:1px solid var(--line);border-radius:10px;padding:12px">
  <summary style="cursor:pointer;font-weight:600;color:var(--text);font-family:'JetBrains Mono',monospace;display:flex;align-items:center;gap:8px">${esc(s.domain)} ${badge} <span style="color:var(--muted);font-weight:400">${s.findings.length} finding(s)</span></summary>
  <p style="margin:8px 0;color:var(--muted);font-size:13px">${esc(s.summary)}</p>
  <ul style="font-size:13px">${s.findings.slice(0, 10).map((f) => `<li><span class="pill ${pillClass(f.severity)}">${esc(f.severity)}</span> <code>${esc(markdownLocation(f))}</code> ${esc(f.finding)}</li>`).join('')}</ul>
</details>`;
  }).join('')}
</section>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width,initial-scale=1.0" name="viewport"/>
<title>Aion Audit · ${esc(new Date(report.createdAt).toLocaleDateString('pt-BR'))}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet"/>
<style>${AUDIT_HTML_CSS}</style>
</head>
<body>
<header class="header">
  <div style="display:flex;align-items:center;gap:12px">
    <span class="brand">Aion</span>
    <span style="color:#414752">·</span>
    <span style="font-size:13px;color:var(--muted);font-family:'JetBrains Mono',monospace">${esc(dateStr)}</span>
  </div>
  <div style="display:flex;align-items:center;gap:8px">
    <a href="../../index.html" style="padding:6px 12px;border:1px solid var(--line);border-radius:8px;color:var(--dim);font-size:13px;font-family:'JetBrains Mono',monospace">← Dashboard</a>
  </div>
</header>
<aside class="sidebar">
  <p style="margin:0 0 4px;font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace">${report.findings.length} findings · ${report.totalFiles} files</p>
  <div class="sep"></div>
  <a href="#overview"><span class="ms material-symbols-outlined" style="font-size:18px">dashboard</span>Overview</a>
  <a href="#cost"><span class="ms material-symbols-outlined" style="font-size:18px">payments</span>Cost &amp; Performance</a>
  <a href="#actions"><span class="ms material-symbols-outlined" style="font-size:18px">task_alt</span>Action Plan</a>
  <a href="#findings"><span class="ms material-symbols-outlined" style="font-size:18px">bug_report</span>Findings</a>
  <a href="#personas"><span class="ms material-symbols-outlined" style="font-size:18px">groups</span>Personas</a>
  <a href="#files"><span class="ms material-symbols-outlined" style="font-size:18px">folder_special</span>File Hotspots</a>
  ${sectionsByDomain.length > 0 ? '<a href="#domain-breakdown"><span class="ms material-symbols-outlined" style="font-size:18px">category</span>Domain Breakdown</a>' : ''}
  <a href="#history"><span class="ms material-symbols-outlined" style="font-size:18px">history</span>History</a>
  <a href="#raw"><span class="ms material-symbols-outlined" style="font-size:18px">code</span>Raw Data</a>
  <div class="sidebar-footer">
    <p class="sidebar-footer-lbl">Feedback &amp; Contato</p>
    <a href="mailto:brunoinacio30000@hotmail.com"><span class="ms material-symbols-outlined" style="font-size:18px">mail</span>Email</a>
    <a href="https://www.linkedin.com/in/bruno-inacio-036530170/" target="_blank" rel="noopener noreferrer"><span class="ms material-symbols-outlined" style="font-size:18px">person</span>LinkedIn</a>
  </div>
</aside>
<main class="main">

<section id="overview">
  <div class="bento">
    <div class="bento-hero">
      <h1>Audit Report</h1>
      <p>${esc(report.summary)}</p>
      <p style="margin-top:6px">${esc(fmtDur(report.durationMs))} · ${report.totalFiles} files · ${esc(dateStr)}</p>
    </div>
    <div class="stat-card"><span class="stat-label">Findings</span><div class="stat-num">${report.findings.length}</div></div>
    <div class="stat-card"><span class="stat-label">Critical</span><div class="stat-num crit">${report.criticalCount}</div></div>
    <div class="stat-card"><span class="stat-label">Actions</span><div class="stat-num">${actions.length}</div></div>
  </div>
  ${report.topPriorities.length > 0 ? `<div style="margin-top:16px"><h2 style="margin-bottom:10px">Top Priorities</h2><ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">${report.topPriorities.map((p) => `<li style="font-size:14px;color:var(--dim)">${esc(p)}</li>`).join('')}</ol></div>` : ''}
</section>

${costSection}

<section id="actions"><h2>Action Plan (${actions.length})</h2>${actionCards || '<p style="color:var(--muted)">No action items.</p>'}</section>

<section id="findings"><h2>Findings (${report.findings.length})</h2>
  <div class="filters">
    <input id="q" placeholder="Search findings, files...">
    <select id="flt-severity"><option value="">All severities</option>${filterOptions(bySeverity)}</select>
    <select id="flt-persona"><option value="">All personas</option>${filterOptions(byPersona)}</select>
    <select id="flt-category"><option value="">All categories</option>${filterOptions(byCategory)}</select>
  </div>
  <table id="findingsTable"><thead><tr><th>#</th><th>Severity</th><th>Category</th><th>Persona</th><th>Location</th><th>Finding</th></tr></thead><tbody>${rows}</tbody></table>
</section>

<section id="personas"><h2>Personas &amp; Categories</h2>
  <div class="stat-grid">
    <div class="stat-card"><h3>By Persona</h3><ul class="stat-ul">${statRows(byPersona, 'persona')}</ul></div>
    <div class="stat-card"><h3>By Severity</h3><ul class="stat-ul">${statRows(bySeverity, 'severity')}</ul></div>
    <div class="stat-card"><h3>By Category</h3><ul class="stat-ul">${statRows(byCategory, 'category')}</ul></div>
  </div>
</section>

${domainSection}

<section id="files"><h2>File Hotspots</h2>
  <div class="hotspots">${hotspots.slice(0, 30).map((h) => `<div class="hotspot"><div><code>${esc(h.file)}</code><div style="margin-top:4px">${h.categories.map((c) => `<span class="domain-pill">${esc(c)}</span>`).join('')}</div></div><strong class="${pillClass(h.maxSeverity)}" style="font-size:16px;font-weight:700">${h.findings}</strong></div>`).join('') || '<p style="color:var(--muted)">No hotspots.</p>'}</div>
</section>

${historySection}

<section id="raw"><h2>Raw Data</h2>
  <ul style="display:flex;flex-direction:column;gap:6px;list-style:none;padding:0;font-family:'JetBrains Mono',monospace;font-size:13px">
    <li><a href="digest.md">digest.md</a></li>
    <li><a href="ai-context.md">ai-context.md</a></li>
    <li><a href="report.json">report.json</a></li>
  </ul>
</section>

</main>
<script>
var q=document.getElementById('q'),fs=document.getElementById('flt-severity'),fp=document.getElementById('flt-persona'),fc=document.getElementById('flt-category'),trows=Array.from(document.querySelectorAll('#findingsTable tbody tr'));
function applyFilters(){var text=q.value.toLowerCase();trows.forEach(function(row){var ok=(!text||row.textContent.toLowerCase().includes(text))&&(!fs.value||row.dataset.severity===fs.value)&&(!fp.value||row.dataset.persona===fp.value)&&(!fc.value||row.dataset.category===fc.value);row.style.display=ok?'':'none';});}
[q,fs,fp,fc].forEach(function(el){el.addEventListener('input',applyFilters);});
</script>
</body>
</html>`;
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
  writeFileSync(join(dir, 'latest-audit.json'), JSON.stringify({
    runDir: paths.runDir,
    html: paths.html,
    digest: paths.digest,
    aiContext: paths.aiContext,
    report: paths.report,
    dashboard: paths.dashboard,
    project: paths.project,
    createdAt,
  }, null, 2), 'utf8');
  saveDomainSnapshot(cwd, report);
  return { ...paths, project: projectReportPath(cwd) };
}
