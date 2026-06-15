export function projectReportCss(gradeColor: string): string {
  return `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap');
*{box-sizing:border-box}
:root{--bg:#09090b;--s1:#0f0f14;--s2:#141420;--s3:#1c1c28;--line:#2c2c3e;--text:#eeeef2;--muted:#64647a;--dim:#a0a0bc;--accent:#a3ff47}
body{background:var(--bg);color:var(--text);font:14px/1.6 'Outfit',system-ui,sans-serif;margin:0;-webkit-font-smoothing:antialiased}
nav{position:sticky;top:0;background:rgba(9,9,11,.94);border-bottom:1px solid var(--line);padding:0 24px;height:48px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;z-index:2;backdrop-filter:blur(16px)}
a{color:var(--accent);text-decoration:none}a:hover{opacity:.75}
nav a{font-size:11px;white-space:nowrap;font-family:'JetBrains Mono',monospace;color:var(--dim);transition:color .12s}
nav a:hover{color:var(--accent)}
.container{max-width:1200px;margin:auto;padding:28px 24px}
.header{border:1px solid var(--line);background:var(--s1);border-radius:12px;padding:24px;display:flex;justify-content:space-between;gap:18px;animation:fadeUp .38s ease both}
.header h1{margin:0 0 6px;font-size:28px;line-height:1.1;font-weight:900;letter-spacing:-.03em}
.header p{margin:0;color:var(--muted);font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.6}
.score{color:${gradeColor};text-align:right;min-width:140px}
.score strong{display:block;font-size:54px;line-height:1;font-weight:900;letter-spacing:-.04em}
.score span{display:block;margin-top:6px;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;font-family:'JetBrains Mono',monospace}
h2{color:var(--accent);border-bottom:1px solid var(--line);padding-bottom:8px;margin-top:36px;font-size:14px;font-weight:700;letter-spacing:-.01em}
h3{margin:16px 0 10px;font-size:13px;font-weight:600;color:var(--dim)}
.dim-row{display:grid;grid-template-columns:140px minmax(120px,1fr) 42px minmax(180px,1fr);gap:12px;align-items:center;margin:7px 0}
.bar{background:var(--s3);height:6px;border-radius:3px;overflow:hidden}
.bar div{height:6px;border-radius:3px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.card{background:var(--s1);border:1px solid var(--line);border-radius:10px;padding:14px;min-width:0;transition:border-color .12s}
.card:hover{border-color:var(--s3)}
.card strong{font-size:22px;overflow-wrap:anywhere;font-weight:800;letter-spacing:-.02em}
.card p{margin:6px 0 0;color:var(--muted);font-size:11px;font-family:'JetBrains Mono',monospace}
.mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--s1);border:1px solid var(--line);border-radius:8px;overflow:hidden;table-layout:auto}
td,th{border-bottom:1px solid var(--s2);padding:9px 10px;text-align:left;vertical-align:top}
td{overflow-wrap:anywhere}
th{color:var(--muted);font-size:9px;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.08em;background:var(--s2)}
.muted{color:var(--muted)}
.warn{color:#ffb020}
.ok{color:#34d399}
.sev-high{color:#ff4d4d}
.graph-wrap{background:var(--s1);border:1px solid var(--line);border-radius:10px;overflow:auto;margin:14px 0}
.graph-wrap svg{display:block;min-width:900px;width:100%;height:auto}
.split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
section{scroll-margin-top:60px;animation:fadeUp .38s ease both}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:900px){
  nav{gap:10px;padding:0 14px}
  .container{padding:16px}
  .grid,.split{grid-template-columns:1fr}
  .dim-row{grid-template-columns:1fr 1fr 42px}
  .dim-row small{grid-column:1/-1}
  .header{display:block}
  .score{text-align:left;margin-top:16px}
  table{display:block;overflow-x:auto}
}
@media print{
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  nav{display:none}
  body{background:#fff;color:#111;font-size:11px}
  .container{max-width:100%;padding:12px}
  .header{background:#f5f5f5;border-color:#ddd}
  .score strong{font-size:36px}
  .card{background:#f9f9f9;border-color:#ddd}
  .graph-wrap{overflow:hidden}
  section{animation:none}
  a{color:#000}
}`;
}
