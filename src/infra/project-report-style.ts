export function projectReportCss(gradeColor: string): string {
  return `
*{box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;margin:0}
nav{position:sticky;top:0;background:#161b22;border-bottom:1px solid #30363d;padding:12px 24px;display:flex;gap:14px;flex-wrap:wrap;z-index:2}
a{color:#79c0ff;text-decoration:none}
nav a{font-size:13px;white-space:nowrap}
.container{max-width:1200px;margin:auto;padding:24px}
.header{border:1px solid #30363d;background:#161b22;border-radius:8px;padding:22px;display:flex;justify-content:space-between;gap:18px}
.header h1{margin:0 0 8px;font-size:30px;line-height:1.1}
.header p{margin:0;color:#8b949e}
.score{color:${gradeColor};text-align:right;min-width:150px}
.score strong{display:block;font-size:48px;line-height:1;font-weight:800}
.score span{display:block;margin-top:6px;color:#8b949e;font-size:13px;font-weight:700;text-transform:uppercase}
h2{color:#79c0ff;border-bottom:1px solid #30363d;padding-bottom:8px;margin-top:34px}
h3{margin:18px 0 10px}
.dim-row{display:grid;grid-template-columns:140px minmax(120px,1fr) 42px minmax(180px,1fr);gap:12px;align-items:center;margin:7px 0}
.bar{background:#21262d;height:8px;border-radius:4px;overflow:hidden}
.bar div{height:8px;border-radius:4px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;min-width:0}
.card strong{font-size:24px;overflow-wrap:anywhere}
.card p{margin:8px 0 0;color:#8b949e}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
table{width:100%;border-collapse:collapse;table-layout:auto}
td,th{border-bottom:1px solid #21262d;padding:8px;text-align:left;vertical-align:top}
td{overflow-wrap:anywhere}
th{color:#8b949e;font-size:12px;text-transform:uppercase}
.muted{color:#8b949e}
.warn{color:#e3b341}
.ok{color:#3fb950}
.sev-high{color:#f85149}
.graph-wrap{background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:auto;margin:14px 0}
.graph-wrap svg{display:block;min-width:900px;width:100%;height:auto}
.split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
section{scroll-margin-top:70px}
@media(max-width:900px){
  nav{gap:10px;padding:10px 14px}
  .container{padding:16px}
  .grid,.split{grid-template-columns:1fr}
  .dim-row{grid-template-columns:1fr 1fr 42px}
  .dim-row small{grid-column:1 / -1}
  .header{display:block}
  .score{text-align:left;margin-top:16px}
  table{display:block;overflow-x:auto;white-space:normal}
}`;
}
