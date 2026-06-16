import { esc, fmtUsd, fmtDur } from './audit-report-html.js';
import type { AuditHistoryEntry } from './audit-model.js';

export function renderDashboardHtml(history: AuditHistoryEntry[]): string {
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
      <td><a href="${esc(h.runRelDir)}/index.html" style="color:${isLatest ? '#a3ff47' : '#a0a0bc'};font-family:'JetBrains Mono',monospace;font-size:12px">${esc(new Date(h.createdAt).toLocaleString())}</a>${isLatest ? ' <span style="display:inline-flex;align-items:center;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;background:rgba(163,255,71,.1);color:#a3ff47;border:1px solid rgba(163,255,71,.2);margin-left:8px;font-family:\'JetBrains Mono\',monospace;letter-spacing:.06em">LATEST</span>' : ''}</td>
      <td style="color:#ff4d4d;font-family:'JetBrains Mono',monospace;font-weight:700">${h.criticalCount}${deltaStr}</td>
      <td style="color:#ffb020;font-family:'JetBrains Mono',monospace">${h.highCount}</td>
      <td style="color:#64647a;font-family:'JetBrains Mono',monospace">${h.totalFiles}</td>
      <td style="color:#64647a;font-family:'JetBrains Mono',monospace">${esc(fmtUsd(h.costUsd))}</td>
      <td style="color:#64647a;font-family:'JetBrains Mono',monospace">${esc(fmtDur(h.durationMs))}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
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
  <span class="hdr-meta">${history.length} run${history.length !== 1 ? 's' : ''} · ${esc(new Date().toLocaleString())}</span>
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
  ${latest ? `<div class="latest-link">Latest audit: <a href="${esc(latest.runRelDir)}/index.html">${esc(new Date(latest.createdAt).toLocaleString())}</a></div>` : ''}
  <h2>All Runs</h2>
  <table>
    <thead><tr><th>Run</th><th>Critical</th><th>High</th><th>Files</th><th>Cost</th><th>Duration</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
</body>
</html>`;
}
