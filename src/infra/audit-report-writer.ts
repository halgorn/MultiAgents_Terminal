import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AUDIT_HTML_CSS } from './audit-report-css.js';
import type { AuditFinding, AuditReport } from '../schemas/audit.js';
import { saveDomainSnapshot, projectReportPath } from './project-report.js';
import { AI_RUNTIME_DIR } from './paths.js';
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

export const DEFAULT_AI_CONTEXT_BUDGET = 8000;

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
  const sectionsByDomain = report.sections ?? [];
  const currentStamp = report.createdAt.replace(/[:.]/g, '-');
  const dateStr = new Date(report.createdAt).toLocaleString('pt-BR');

  const pillClass = (sev: string) => ({ critical: 'pill-crit', high: 'pill-high', medium: 'pill-med', low: 'pill-low', info: 'pill-info' }[sev] ?? 'pill-low');

  const actionCards = actions.map((item, idx) => `
<article class="action-card ac-${esc(item.severity)}" data-severity="${esc(item.severity)}" data-category="${esc(item.category)}">
  <div class="action-meta">
    <span class="pill ${pillClass(item.severity)}">${esc(item.severity.toUpperCase())}</span>
    <span style="color:var(--muted);font-size:12px;font-family:'JetBrains Mono',monospace">#${item.id} · ${item.findings.length} findings · ${item.files.length} files</span>
    <button class="copy-btn" onclick="copyCard(${idx})" title="Copy as Markdown">⎘ copy</button>
  </div>
  <h3>${esc(item.title)}</h3>
  <p>${esc(item.recommendation)}</p>
  <details><summary>Evidence and files</summary>
    <ul style="font-size:12px;margin:6px 0">${item.files.map((file) => `<li><code>${esc(file.file)}${file.lines.length ? ':' + esc(file.lines.slice(0, 8).join(',')) : ''}</code></li>`).join('')}</ul>
    <ol style="font-size:12px">${item.findings.slice(0, 6).map((finding) => `<li><code>${esc(markdownLocation(finding))}</code> ${esc(finding.finding)}</li>`).join('')}</ol>
  </details>
</article>`).join('');

  const sortedFindings = [...report.findings].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));

  const findingsJson = JSON.stringify(sortedFindings.map((f, idx) => ({
    idx, severity: f.severity, category: f.category, persona: f.persona ?? 'local',
    location: markdownLocation(f), finding: f.finding, recommendation: String(f.recommendation ?? ''),
  }))).replace(/<\/script>/gi, '<\\/script>');

  const actionsJson = JSON.stringify(actions.map((item, idx) => ({
    idx, severity: item.severity, category: item.category, title: item.title,
    recommendation: item.recommendation, filesCount: item.files.length, findingsCount: item.findings.length,
    files: item.files.map((fi) => `${fi.file}${fi.lines.length ? ':' + fi.lines.slice(0, 8).join(',') : ''}`),
    evidences: item.findings.slice(0, 6).map((fi) => ({ location: markdownLocation(fi), finding: fi.finding })),
  }))).replace(/<\/script>/gi, '<\\/script>');

  const rows = sortedFindings.map((f, idx) => `
<tr data-severity="${esc(f.severity)}" data-category="${esc(f.category)}" data-persona="${esc(f.persona ?? 'local')}" data-file="${esc(f.file ?? '')}" data-idx="${idx}">
  <td style="width:28px;padding:6px 4px;text-align:center"><input type="checkbox" class="row-cb" data-idx="${idx}"></td>
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
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>
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

<section id="findings">
  <div class="sec-hdr">
    <h2>Findings (${report.findings.length})</h2>
    <div class="sec-hdr-btns">
      <button class="btn btn-ghost" onclick="copyAllVisible()" title="Copy all visible as Markdown">⎘ Copy MD</button>
      <button class="btn btn-ghost" onclick="downloadAllVisible()" title="Download all visible as .md file">↓ .md</button>
    </div>
  </div>
  <div class="filters">
    <input id="q" placeholder="Search findings, files...">
    <select id="flt-severity"><option value="">All severities</option>${filterOptions(bySeverity)}</select>
    <select id="flt-persona"><option value="">All personas</option>${filterOptions(byPersona)}</select>
    <select id="flt-category"><option value="">All categories</option>${filterOptions(byCategory)}</select>
  </div>
  <table id="findingsTable"><thead><tr><th style="width:28px"><input type="checkbox" id="select-all-cb" title="Select / deselect all visible"></th><th>#</th><th>Severity</th><th>Category</th><th>Persona</th><th>Location</th><th>Finding</th></tr></thead><tbody>${rows}</tbody></table>
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
<div id="export-bar" class="export-bar">
  <span id="sel-count" class="sel-count">0 findings selected</span>
  <button class="btn btn-primary" onclick="copySelectedMd()">⎘ Copy MD</button>
  <button class="btn btn-ghost" onclick="downloadSelectedMd()">↓ Download .md</button>
  <button class="btn btn-ghost" onclick="openAiPrompt()">✦ AI Prompt</button>
  <button class="btn btn-danger" onclick="clearSelection()" style="margin-left:auto">✕ Clear</button>
</div>

<div id="ai-modal" class="modal-overlay">
  <div class="modal">
    <div class="modal-hdr">
      <h3>✦ AI Prompt — paste into your AI assistant</h3>
      <button class="copy-btn" onclick="closeModal()">✕ close</button>
    </div>
    <textarea id="ai-prompt-text" spellcheck="false"></textarea>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" onclick="copyAiPrompt()">⎘ Copy prompt</button>
    </div>
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
(function(){
var FINDINGS=${findingsJson};
var ACTIONS=${actionsJson};
var DATE="${esc(dateStr)}";
var q=document.getElementById('q');
var fs=document.getElementById('flt-severity');
var fp=document.getElementById('flt-persona');
var fc=document.getElementById('flt-category');
var trows=Array.from(document.querySelectorAll('#findingsTable tbody tr'));
var exportBar=document.getElementById('export-bar');
var selCountEl=document.getElementById('sel-count');
var selectAllCb=document.getElementById('select-all-cb');
var selectedIdxs=new Set();

function visibleRows(){return trows.filter(function(r){return r.style.display!=='none';});}

function applyFilters(){
  var text=q.value.toLowerCase();
  trows.forEach(function(row){
    var ok=(!text||row.textContent.toLowerCase().includes(text))
      &&(!fs.value||row.dataset.severity===fs.value)
      &&(!fp.value||row.dataset.persona===fp.value)
      &&(!fc.value||row.dataset.category===fc.value);
    row.style.display=ok?'':'none';
  });
  updateSelectAllState();
}
[q,fs,fp,fc].forEach(function(el){el.addEventListener('input',applyFilters);});

function updateSelCount(){
  var n=selectedIdxs.size;
  selCountEl.textContent=n+' finding'+(n!==1?'s':'')+' selected';
  exportBar.classList.toggle('visible',n>0);
}

function updateSelectAllState(){
  var vis=visibleRows();
  var allSel=vis.length>0&&vis.every(function(r){return selectedIdxs.has(+r.dataset.idx);});
  var anySel=vis.some(function(r){return selectedIdxs.has(+r.dataset.idx);});
  selectAllCb.checked=allSel;
  selectAllCb.indeterminate=!allSel&&anySel;
}

document.querySelectorAll('.row-cb').forEach(function(cb){
  cb.addEventListener('change',function(){
    var idx=+cb.dataset.idx;
    if(cb.checked)selectedIdxs.add(idx);else selectedIdxs.delete(idx);
    cb.closest('tr').classList.toggle('row-selected',cb.checked);
    updateSelCount();
    updateSelectAllState();
  });
});

selectAllCb.addEventListener('change',function(){
  var vis=visibleRows();
  vis.forEach(function(r){
    var idx=+r.dataset.idx;
    var rowCb=r.querySelector('.row-cb');
    if(selectAllCb.checked){selectedIdxs.add(idx);r.classList.add('row-selected');if(rowCb)rowCb.checked=true;}
    else{selectedIdxs.delete(idx);r.classList.remove('row-selected');if(rowCb)rowCb.checked=false;}
  });
  updateSelCount();
});

window.clearSelection=function(){
  selectedIdxs.clear();
  document.querySelectorAll('.row-cb').forEach(function(cb){cb.checked=false;});
  document.querySelectorAll('.row-selected').forEach(function(r){r.classList.remove('row-selected');});
  selectAllCb.checked=false;
  selectAllCb.indeterminate=false;
  updateSelCount();
};

function showToast(msg){
  var el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  setTimeout(function(){el.classList.remove('show');},2500);
}

function findingToMd(f){
  return '### Finding #'+(f.idx+1)+' \u00b7 '+f.severity.toUpperCase()+'\n'
    +'**Category**: '+f.category+'\n'
    +'**Persona**: '+f.persona+'\n'
    +'**Location**: \`'+f.location+'\`\n'
    +'**Finding**: '+f.finding+'\n'
    +(f.recommendation?'**Recommendation**: '+f.recommendation+'\n':'')
    +'\n---\n\n';
}

function actionToMd(a){
  var md='## ['+a.severity.toUpperCase()+'] '+a.title+'\n';
  md+='**Category**: '+a.category+' \u00b7 '+a.findingsCount+' findings \u00b7 '+a.filesCount+' files\n\n';
  md+=a.recommendation+'\n\n';
  if(a.files&&a.files.length)md+='**Files**:\n'+a.files.map(function(f){return '- \`'+f+'\`';}).join('\n')+'\n\n';
  if(a.evidences&&a.evidences.length)md+='**Evidence**:\n'+a.evidences.map(function(e){return '- \`'+e.location+'\` '+e.finding;}).join('\n')+'\n';
  return md;
}

function buildMd(items){
  return '# Audit Findings ('+items.length+')\nDate: '+DATE+'\n\n'+items.map(findingToMd).join('');
}

window.copySelectedMd=function(){
  var items=Array.from(selectedIdxs).sort(function(a,b){return a-b;}).map(function(i){return FINDINGS[i];}).filter(Boolean);
  if(!items.length)return;
  navigator.clipboard.writeText(buildMd(items)).then(function(){showToast('\u2713 Copied '+items.length+' findings as Markdown');});
};

window.downloadSelectedMd=function(){
  var items=Array.from(selectedIdxs).sort(function(a,b){return a-b;}).map(function(i){return FINDINGS[i];}).filter(Boolean);
  if(!items.length)return;
  var blob=new Blob([buildMd(items)],{type:'text/markdown'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='findings-'+items.length+'.md';a.click();
  showToast('\u2713 Downloaded findings-'+items.length+'.md');
};

window.openAiPrompt=function(){
  var items=Array.from(selectedIdxs).sort(function(a,b){return a-b;}).map(function(i){return FINDINGS[i];}).filter(Boolean);
  if(!items.length)return;
  var prompt='I have an audit report with '+items.length+' finding'+(items.length!==1?'s':'')+' from '+DATE+'. Please:\n'
    +'1. Identify the top issues to fix immediately\n'
    +'2. Group related findings that should be addressed together\n'
    +'3. Suggest quick wins (low effort, high impact)\n'
    +'4. Flag any that may be false positives\n\n'
    +'---\n\n'+items.map(findingToMd).join('');
  document.getElementById('ai-prompt-text').value=prompt;
  document.getElementById('ai-modal').classList.add('open');
};

window.copyAiPrompt=function(){
  var text=document.getElementById('ai-prompt-text').value;
  navigator.clipboard.writeText(text).then(function(){showToast('\u2713 Copied AI prompt');});
};

window.closeModal=function(){document.getElementById('ai-modal').classList.remove('open');};
document.getElementById('ai-modal').addEventListener('click',function(e){if(e.target===this)closeModal();});

window.copyCard=function(idx){
  var a=ACTIONS[idx];if(!a)return;
  navigator.clipboard.writeText(actionToMd(a)).then(function(){showToast('\u2713 Copied action item');});
};

window.copyAllVisible=function(){
  var vis=visibleRows().map(function(r){return FINDINGS[+r.dataset.idx];}).filter(Boolean);
  if(!vis.length){showToast('No visible findings');return;}
  navigator.clipboard.writeText(buildMd(vis)).then(function(){showToast('\u2713 Copied '+vis.length+' findings');});
};

window.downloadAllVisible=function(){
  var vis=visibleRows().map(function(r){return FINDINGS[+r.dataset.idx];}).filter(Boolean);
  if(!vis.length){showToast('No visible findings');return;}
  var blob=new Blob([buildMd(vis)],{type:'text/markdown'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='audit-findings.md';a.click();
  showToast('\u2713 Downloaded audit-findings.md');
};

document.addEventListener('keydown',function(e){
  if(e.key==='Escape')closeModal();
  if((e.metaKey||e.ctrlKey)&&e.key==='a'){
    var tag=document.activeElement?document.activeElement.tagName:'';
    if(tag!=='INPUT'&&tag!=='TEXTAREA'){e.preventDefault();selectAllCb.checked=true;selectAllCb.dispatchEvent(new Event('change'));}
  }
});
})();
</script>
</body>
</html>`;
}

function renderDashboardHtml(history: AuditHistoryEntry[]): string {
  const sorted = history.slice().reverse();
  const latest = sorted[0];
  const totalCost = history.reduce((s, h) => s + h.costUsd, 0);
  const avgCrit = history.length > 0 ? (history.reduce((s, h) => s + h.criticalCount, 0) / history.length).toFixed(1) : '0';
  const prev = sorted[1];
  const critDelta = latest && prev ? latest.criticalCount - prev.criticalCount : 0;
  const trendLabel = critDelta > 0 ? `↑${critDelta} vs prev` : critDelta < 0 ? `↓${Math.abs(critDelta)} vs prev` : prev ? '= vs prev' : 'first run';
  const trendColor = critDelta > 0 ? '#ff4d4d' : critDelta < 0 ? '#34d399' : '#64647a';

  const rows = sorted.map((h, i) => {
    const p = sorted[i + 1];
    const delta = p ? h.criticalCount - p.criticalCount : 0;
    const deltaStr = delta > 0
      ? `<span style="color:#ff4d4d;font-size:10px;font-family:'JetBrains Mono',monospace"> ↑${delta}</span>`
      : delta < 0
        ? `<span style="color:#34d399;font-size:10px;font-family:'JetBrains Mono',monospace"> ↓${Math.abs(delta)}</span>`
        : '';
    const isLatest = i === 0;
    return `<tr style="${isLatest ? 'background:rgba(163,255,71,.03)' : ''}">
      <td><a href="${esc(h.runRelDir)}/index.html" style="color:${isLatest ? '#a3ff47' : '#a0a0bc'};font-family:'JetBrains Mono',monospace;font-size:12px">${esc(new Date(h.createdAt).toLocaleString('pt-BR'))}</a>${isLatest ? ' <span style="display:inline-flex;align-items:center;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;background:rgba(163,255,71,.1);color:#a3ff47;border:1px solid rgba(163,255,71,.2);margin-left:8px;font-family:\'JetBrains Mono\',monospace;letter-spacing:.06em">LATEST</span>' : ''}</td>
      <td style="color:#ff4d4d;font-family:'JetBrains Mono',monospace;font-weight:700">${h.criticalCount}${deltaStr}</td>
      <td style="color:#ffb020;font-family:'JetBrains Mono',monospace">${h.highCount}</td>
      <td style="color:#64647a;font-family:'JetBrains Mono',monospace">${h.totalFiles}</td>
      <td style="color:#64647a;font-family:'JetBrains Mono',monospace">${esc(fmtUsd(h.costUsd))}</td>
      <td style="color:#64647a;font-family:'JetBrains Mono',monospace">${esc(fmtDur(h.durationMs))}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aion — Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
:root{--bg:#09090b;--s1:#0f0f14;--s2:#141420;--s3:#1c1c28;--line:#2c2c3e;--text:#eeeef2;--muted:#64647a;--dim:#a0a0bc;--accent:#a3ff47}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Outfit',system-ui,sans-serif;font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;min-height:100vh}
a{color:var(--accent);text-decoration:none}a:hover{opacity:.75}
.hdr{display:flex;align-items:center;justify-content:space-between;padding:0 32px;height:54px;border-bottom:1px solid var(--line);background:rgba(9,9,11,.94);backdrop-filter:blur(16px);position:sticky;top:0;z-index:10}
.brand{font-size:17px;font-weight:900;color:var(--accent);letter-spacing:-.04em}
.hdr-meta{font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace}
.body{max-width:1080px;margin:0 auto;padding:40px 32px 60px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:40px;animation:fadeUp .38s ease both}
.kpi{background:var(--s1);border:1px solid var(--line);border-radius:14px;padding:20px 22px;display:flex;flex-direction:column;gap:6px;transition:border-color .15s}
.kpi:hover{border-color:var(--s3)}
.kpi-label{font-size:9px;font-family:'JetBrains Mono',monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}
.kpi-num{font-size:40px;font-weight:900;letter-spacing:-.04em;line-height:1;font-family:'Outfit',sans-serif}
.kpi-sub{font-size:11px;font-family:'JetBrains Mono',monospace;margin-top:2px}
h2{font-size:14px;font-weight:700;color:var(--text);border-bottom:1px solid var(--line);padding-bottom:10px;margin:0 0 16px;letter-spacing:-.01em}
.latest-link{display:inline-flex;align-items:center;gap:8px;margin-bottom:32px;font-size:13px;color:var(--dim);animation:fadeUp .38s .06s ease both;opacity:0;animation-fill-mode:both}
.latest-link a{color:var(--accent);font-family:'JetBrains Mono',monospace;font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--s1);border:1px solid var(--line);border-radius:12px;overflow:hidden;animation:fadeUp .38s .12s ease both;opacity:0;animation-fill-mode:both}
th{text-align:left;border-bottom:1px solid var(--line);padding:10px 14px;color:var(--muted);font-size:9px;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.1em;background:var(--s2)}
td{border-bottom:1px solid var(--s2);padding:11px 14px;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.015)}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:680px){.kpis{grid-template-columns:1fr 1fr}.body{padding:28px 16px 40px}}
</style>
</head>
<body>
<header class="hdr">
  <div class="brand">Aion</div>
  <span class="hdr-meta">${history.length} run${history.length !== 1 ? 's' : ''} · ${esc(new Date().toLocaleString('pt-BR'))}</span>
</header>
<div class="body">
  <div class="kpis">
    <div class="kpi" style="${latest && latest.criticalCount > 0 ? 'border-color:rgba(255,77,77,.25)' : ''}">
      <div class="kpi-label">Critical — latest</div>
      <div class="kpi-num" style="color:${latest && latest.criticalCount > 0 ? '#ff4d4d' : '#34d399'}">${latest?.criticalCount ?? 0}</div>
      <div class="kpi-sub" style="color:${trendColor}">${trendLabel}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">High — latest</div>
      <div class="kpi-num" style="color:#ffb020">${latest?.highCount ?? 0}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Total runs</div>
      <div class="kpi-num">${history.length}</div>
      <div class="kpi-sub" style="color:var(--muted)">avg ${avgCrit} critical/run</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Total spent</div>
      <div class="kpi-num" style="font-size:28px;margin-top:6px">${esc(fmtUsd(totalCost))}</div>
    </div>
  </div>
  ${latest ? `<div class="latest-link">Latest audit: <a href="${esc(latest.runRelDir)}/index.html">${esc(new Date(latest.createdAt).toLocaleString('pt-BR'))}</a></div>` : ''}
  <h2>All Runs</h2>
  <table>
    <thead><tr><th>Run</th><th>Critical</th><th>High</th><th>Files</th><th>Cost</th><th>Duration</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
</body>
</html>`;
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
  aiContextBudget = DEFAULT_AI_CONTEXT_BUDGET,
  costSummary?: CostSummary,
): SavedAuditPaths {
  const dir = join(cwd, AI_RUNTIME_DIR, 'reports');
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
