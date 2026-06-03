import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AuditFinding, AuditReport } from '../schemas/audit.js';
import {
  buildActionItems,
  buildFileHotspots,
  groupFindings,
  maxSeverity,
  markdownLocation,
  renderActionPlan,
  renderAiContext,
  renderDigest,
  type FullSavedAuditReport,
  type SavedAuditPaths,
  SEVERITY_RANK,
} from './audit-model.js';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSummary(report: FullSavedAuditReport): string {
  const actions = buildActionItems(report.findings).slice(0, 10);
  const hotspots = buildFileHotspots(report.findings).slice(0, 10);
  return [
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
    report.summary,
    '',
    '## Top Priorities',
    ...(report.topPriorities.length ? report.topPriorities.map((p, i) => `${i + 1}. ${p}`) : ['No top priorities.']),
    '',
    '## Consolidated Actions',
    ...(actions.length ? actions.map((a) => `${a.id}. [${a.severity}] ${a.title} (${a.files.length} file(s))`) : ['No action items.']),
    '',
    '## File Hotspots',
    ...(hotspots.length ? hotspots.map((h) => `- ${h.file}: ${h.findings} finding(s), max ${h.maxSeverity}`) : ['No file hotspots.']),
    '',
    '## Generated Files',
    '- `index.html`: navigable report',
    '- `digest.md`: compact human report',
    '- `ai-context.md`: compact AI-safe report',
    '- `action-plan.md`: consolidated remediation plan',
    '- `report.json`: raw machine-readable audit',
    '- `action-items.json`: consolidated action data',
    '',
  ].join('\n');
}

function renderIndex(report: FullSavedAuditReport): string {
  const byPersona = Object.entries(groupFindings(report.findings, (f) => f.persona ?? 'local'))
    .sort((a, b) => b[1].length - a[1].length);
  return [
    '# Audit Report',
    '',
    `- Created: ${report.createdAt}`,
    `- Duration: ${(report.durationMs / 1000).toFixed(1)}s`,
    `- Files covered: ${report.totalFiles}`,
    `- Findings: ${report.findings.length}`,
    '',
    '## Open First',
    '- `digest.md`: best human reading path',
    '- `ai-context.md`: compact context for another AI',
    '- `index.html`: navigable dashboard',
    '',
    '## Personas',
    ...byPersona.map(([persona, findings]) => `- ${persona}: ${findings.length}`),
    '',
  ].join('\n');
}

function filterOptions(items: Array<[string, AuditFinding[]]>): string {
  return items.map(([key]) => `<option value="${esc(key)}">${esc(key)}</option>`).join('');
}

function renderHtml(report: FullSavedAuditReport): string {
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
  const rows = report.findings.map((f) => `
    <tr data-severity="${esc(f.severity)}" data-category="${esc(f.category)}" data-persona="${esc(f.persona ?? 'local')}" data-file="${esc(f.file)}">
      <td><span class="badge sev-${esc(f.severity)}">${esc(f.severity)}</span></td><td>${esc(f.category)}</td><td>${esc(f.persona ?? 'local')}</td>
      <td><code>${esc(markdownLocation(f))}</code></td><td>${esc(f.finding)}<div class="recommendation">${esc(f.recommendation)}</div></td>
    </tr>`).join('');
  const statList = (items: Array<[string, AuditFinding[]]>, label: string) => items.map(([key, findings]) => {
    const severity = maxSeverity(findings);
    return `<li><span>${esc(key)}</span><strong class="sev-text-${esc(severity)}">${findings.length}</strong><small>${esc(label)} · max ${esc(severity)}</small></li>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aion Audit Report</title><style>
:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--blue:#79c0ff;--yellow:#e3b341;--red:#f85149}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif}a{color:var(--blue)}code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.layout{display:grid;grid-template-columns:250px 1fr;min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;border-right:1px solid var(--line);background:#010409;padding:22px;overflow:auto}
.sidebar a{display:block;padding:7px 0;color:var(--muted);text-decoration:none}main{padding:28px;max-width:1300px}.hero{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:22px}
h2{font-size:20px;margin:34px 0 14px;color:var(--blue)}h3{font-size:15px;margin:10px 0}.muted,.meta{color:var(--muted);font-size:12px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}
.num{font-size:32px;font-weight:700}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.badge{display:inline-flex;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;text-transform:uppercase}
.sev-critical{background:#f8514920;color:var(--red)}.sev-high{background:#e3b34120;color:var(--yellow)}.sev-medium{background:#79c0ff20;color:var(--blue)}.sev-low,.sev-info{background:#8b949e20;color:var(--muted)}
.sev-text-critical{color:var(--red)}.sev-text-high{color:var(--yellow)}.sev-text-medium{color:var(--blue)}.sev-text-low,.sev-text-info{color:var(--muted)}
.action{margin-bottom:12px}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.stats ul{list-style:none;margin:0;padding:0}.stats li{display:grid;grid-template-columns:1fr auto;gap:3px;border-bottom:1px solid #21262d;padding:8px 0}.stats small{grid-column:1/-1;color:var(--muted)}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.filters input,.filters select{background:#010409;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px}table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line)}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #21262d;padding:9px}th{color:var(--muted);font-size:12px}.recommendation{color:var(--muted);font-size:12px;margin-top:4px}
.hotspots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.hotspot{display:grid;grid-template-columns:1fr auto;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px}@media(max-width:900px){.layout{grid-template-columns:1fr}.sidebar{position:relative;height:auto}.cards,.stats,.hotspots{grid-template-columns:1fr}.hero{display:block}}
</style></head><body><div class="layout"><nav class="sidebar"><h1>Aion Audit</h1><p class="muted">${esc(report.createdAt)}</p><a href="#overview">Overview</a><a href="#actions">Action Plan</a><a href="#findings">Findings</a><a href="#personas">Personas</a><a href="#files">Files</a><a href="#raw">Raw Data</a></nav><main>
<section class="hero" id="overview"><div><h1>Audit Report</h1><p class="muted">${esc(report.summary)}</p></div><div class="meta">Duration ${(report.durationMs / 1000).toFixed(1)}s · ${report.totalFiles} files</div></section>
<section class="cards"><div class="card"><div class="num">${report.findings.length}</div><div class="muted">Findings</div></div><div class="card"><div class="num sev-text-critical">${report.criticalCount}</div><div class="muted">Critical</div></div><div class="card"><div class="num sev-text-high">${report.highCount}</div><div class="muted">High</div></div><div class="card"><div class="num">${actions.length}</div><div class="muted">Actions</div></div></section>
<section><h2>Top Priorities</h2><ol>${report.topPriorities.length ? report.topPriorities.map((p) => `<li>${esc(p)}</li>`).join('') : '<li>No top priorities.</li>'}</ol></section>
<section id="actions"><h2>Action Plan</h2>${actionCards || '<p class="muted">No action items.</p>'}</section>
<section id="findings"><h2>Findings</h2><div class="filters"><input id="q" placeholder="Search findings, files, recommendations"><select id="severity"><option value="">All severities</option>${filterOptions(bySeverity)}</select><select id="persona"><option value="">All personas</option>${filterOptions(byPersona)}</select><select id="category"><option value="">All categories</option>${filterOptions(byCategory)}</select></div><table id="findingsTable"><thead><tr><th>Severity</th><th>Category</th><th>Persona</th><th>Location</th><th>Finding</th></tr></thead><tbody>${rows}</tbody></table></section>
<section id="personas"><h2>Personas And Categories</h2><div class="stats"><div class="card"><h3>By Persona</h3><ul>${statList(byPersona, 'persona')}</ul></div><div class="card"><h3>By Severity</h3><ul>${statList(bySeverity, 'severity')}</ul></div><div class="card"><h3>By Category</h3><ul>${statList(byCategory, 'category')}</ul></div></div></section>
<section id="files"><h2>File Hotspots</h2><div class="hotspots">${hotspots.slice(0, 30).map((h) => `<div class="hotspot"><code>${esc(h.file)}</code><strong class="sev-text-${esc(h.maxSeverity)}">${h.findings}</strong><small class="muted">${esc(h.categories.join(', '))}</small></div>`).join('') || '<p class="muted">No hotspots.</p>'}</div></section>
<section id="raw"><h2>Raw Data</h2><ul><li><a href="digest.md">digest.md</a></li><li><a href="ai-context.md">ai-context.md</a></li><li><a href="action-plan.md">action-plan.md</a></li><li><a href="report.json">report.json</a></li><li><a href="action-items.json">action-items.json</a></li></ul></section>
</main></div><script>
const q=document.getElementById('q'),severity=document.getElementById('severity'),persona=document.getElementById('persona'),category=document.getElementById('category'),rows=Array.from(document.querySelectorAll('#findingsTable tbody tr'));
function applyFilters(){const text=q.value.toLowerCase();for(const row of rows){const okText=!text||row.textContent.toLowerCase().includes(text),okSeverity=!severity.value||row.dataset.severity===severity.value,okPersona=!persona.value||row.dataset.persona===persona.value,okCategory=!category.value||row.dataset.category===category.value;row.style.display=okText&&okSeverity&&okPersona&&okCategory?'':'none';}}
[q,severity,persona,category].forEach((el)=>el.addEventListener('input',applyFilters));
</script></body></html>`;
}

export function saveAuditReport(cwd: string, report: AuditReport, durationMs: number, aiContextBudget = 8000): SavedAuditPaths {
  const dir = join(cwd, '.ai-runtime', 'reports');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const createdAt = new Date().toISOString();
  const fullReport: FullSavedAuditReport = { ...report, durationMs, createdAt };
  const legacyJson = join(dir, `audit-${stamp}.json`);
  const runDir = join(dir, 'audits', stamp);
  mkdirSync(runDir, { recursive: true });

  const paths = {
    runDir,
    html: join(runDir, 'index.html'),
    summary: join(runDir, 'summary.md'),
    digest: join(runDir, 'digest.md'),
    aiContext: join(runDir, 'ai-context.md'),
    actionPlan: join(runDir, 'action-plan.md'),
    report: legacyJson,
  };
  writeFileSync(legacyJson, JSON.stringify(fullReport, null, 2), 'utf8');
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(fullReport, null, 2), 'utf8');
  writeFileSync(join(runDir, 'findings-by-persona.json'), JSON.stringify(groupFindings(report.findings, (f) => f.persona ?? 'local'), null, 2), 'utf8');
  writeFileSync(join(runDir, 'findings-by-severity.json'), JSON.stringify(groupFindings(report.findings, (f) => f.severity), null, 2), 'utf8');
  writeFileSync(join(runDir, 'findings-by-category.json'), JSON.stringify(groupFindings(report.findings, (f) => f.category), null, 2), 'utf8');
  writeFileSync(join(runDir, 'files-hotspots.json'), JSON.stringify(buildFileHotspots(report.findings), null, 2), 'utf8');
  writeFileSync(join(runDir, 'action-items.json'), JSON.stringify(buildActionItems(report.findings), null, 2), 'utf8');
  writeFileSync(join(runDir, 'README.md'), renderIndex(fullReport), 'utf8');
  writeFileSync(paths.summary, renderSummary(fullReport), 'utf8');
  writeFileSync(paths.digest, renderDigest(fullReport), 'utf8');
  writeFileSync(paths.aiContext, renderAiContext(fullReport, aiContextBudget), 'utf8');
  writeFileSync(paths.actionPlan, renderActionPlan(fullReport), 'utf8');
  writeFileSync(paths.html, renderHtml(fullReport), 'utf8');
  writeFileSync(join(dir, 'latest-audit.json'), JSON.stringify({ ...paths, createdAt }, null, 2), 'utf8');
  return paths;
}
