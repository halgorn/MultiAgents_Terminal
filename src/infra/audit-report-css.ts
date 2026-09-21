export const AUDIT_HTML_CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#09090b;--s1:#0f0f14;--s2:#141420;--s3:#1c1c28;--s4:#24243a;
  --line:#2c2c3e;--text:#eeeef2;--muted:#64647a;--dim:#a0a0bc;
  --primary:#a3ff47;--primary-btn:#a3ff47;--primary-on:#09090b;
  --surface:var(--s2);--surface-low:var(--s1);--surface-high:var(--s3);--surface-highest:var(--s4);
  --critical:#ff4d4d;--crit-dim:rgba(255,77,77,.12);--crit-border:rgba(255,77,77,.25);
  --high:#ffb020;--high-dim:rgba(255,176,32,.12);--high-border:rgba(255,176,32,.25);
  --med:#60a5fa;--med-dim:rgba(96,165,250,.12);--med-border:rgba(96,165,250,.25);
  --green:#34d399
}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Outfit',system-ui,sans-serif;font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:var(--primary);text-decoration:none}
a:hover{opacity:.75}
code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;background:var(--s3);padding:1px 5px;border-radius:4px}
button{cursor:pointer;font-family:inherit}
.ms{font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;vertical-align:middle;user-select:none;font-size:16px}
.header{position:fixed;top:0;left:0;width:100%;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:0 20px;height:54px;border-bottom:1px solid var(--line);background:rgba(9,9,11,.94);backdrop-filter:blur(16px)}
.brand{font-size:17px;font-weight:900;color:var(--primary);letter-spacing:-.04em;font-family:'Outfit',sans-serif}
.sidebar{position:fixed;left:0;top:0;height:100%;width:220px;display:flex;flex-direction:column;padding:66px 10px 10px;background:var(--s1);border-right:1px solid var(--line);z-index:40;overflow-y:auto}
.sidebar a{display:flex;align-items:center;gap:7px;padding:6px 10px;color:var(--muted);font-size:11px;font-family:'JetBrains Mono',monospace;border-radius:6px;transition:all .12s;white-space:nowrap}
.sidebar a:hover{color:var(--text);background:var(--s3);opacity:1}
.sep{border-top:1px solid var(--line);margin:8px 0}
.main{margin-left:220px;padding:70px 28px 40px;display:flex;flex-direction:column;gap:32px}
.bento{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:12px}
.bento-hero{background:var(--s1);border:1px solid var(--line);border-radius:14px;padding:24px;position:relative;overflow:hidden;animation:fadeUp .38s ease both}
.bento-hero::before{content:'';position:absolute;top:-60px;right:-60px;width:180px;height:180px;background:radial-gradient(circle,rgba(163,255,71,.07) 0%,transparent 70%);pointer-events:none}
.bento-hero h1{margin:0;font-size:20px;font-weight:800;color:var(--text);letter-spacing:-.02em;position:relative}
.bento-hero p{margin:5px 0 0;font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace;position:relative;line-height:1.6}
.stat-card{background:var(--s1);border:1px solid var(--line);border-radius:14px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;animation:fadeUp .38s ease both}
.stat-card:nth-child(2){animation-delay:.06s}
.stat-card:nth-child(3){animation-delay:.12s}
.stat-card:nth-child(4){animation-delay:.18s}
.stat-label{font-size:9px;font-family:'JetBrains Mono',monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}
.stat-num{font-size:34px;font-weight:900;color:var(--text);margin-top:10px;letter-spacing:-.03em;font-family:'Outfit',sans-serif}
.stat-num.crit{color:var(--critical)}
.stat-num.high{color:var(--high)}
h2{font-size:15px;font-weight:700;color:var(--text);border-bottom:1px solid var(--line);padding-bottom:9px;margin:0 0 16px;letter-spacing:-.01em}
h3{font-size:13px;font-weight:600;margin:8px 0;color:var(--dim)}
.pill{display:inline-flex;align-items:center;padding:2px 7px;border-radius:4px;font-size:10px;font-family:'JetBrains Mono',monospace;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.pill-crit{background:var(--crit-dim);color:var(--critical);border:1px solid var(--crit-border)}
.pill-high{background:var(--high-dim);color:var(--high);border:1px solid var(--high-border)}
.pill-med{background:var(--med-dim);color:var(--med);border:1px solid var(--med-border)}
.pill-low,.pill-info{background:rgba(100,100,122,.14);color:var(--muted);border:1px solid rgba(100,100,122,.2)}
.action-card{background:var(--s1);border:1px solid var(--line);border-radius:12px;padding:16px 16px 14px 20px;position:relative;margin-bottom:10px;transition:border-color .15s,transform .15s;animation:fadeUp .35s ease both}
.action-card:hover{border-color:var(--s4);transform:translateX(2px)}
.action-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:12px 0 0 12px}
.action-card.ac-critical::before{background:var(--critical);box-shadow:0 0 8px rgba(255,77,77,.35)}
.action-card.ac-high::before{background:var(--high);box-shadow:0 0 8px rgba(255,176,32,.25)}
.action-card.ac-medium::before{background:var(--med)}
.action-card.ac-low::before,.action-card.ac-info::before{background:var(--muted)}
.action-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.action-card h3{margin:4px 0 6px;font-size:14px;font-weight:700;color:var(--text);letter-spacing:-.01em}
.action-card p{margin:0 0 8px;font-size:13px;color:var(--dim);line-height:1.6}
details summary{cursor:pointer;color:var(--muted);font-size:11px;margin-top:8px;font-family:'JetBrains Mono',monospace;list-style:none;user-select:none}
details summary::-webkit-details-marker{display:none}
details summary::before{content:'▸  '}
details[open] summary::before{content:'▾  '}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.filters input,.filters select{background:var(--s2);color:var(--text);border:1px solid var(--line);border-radius:7px;padding:7px 12px;font-size:12px;font-family:'JetBrains Mono',monospace;outline:none;transition:border-color .12s}
.filters input:focus,.filters select:focus{border-color:var(--primary)}
.filters input::placeholder{color:var(--muted)}
table{width:100%;border-collapse:collapse;background:var(--s1);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:9px 10px}
th{color:var(--muted);font-size:10px;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.06em;background:var(--s2)}
.rec{color:var(--muted);font-size:12px;margin-top:4px;line-height:1.5}
.hotspots{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.hotspot{background:var(--s2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:grid;grid-template-columns:1fr auto;gap:4px;align-items:start;transition:border-color .12s}
.hotspot:hover{border-color:var(--s4)}
.domain-pill{display:inline-block;background:var(--s3);border-radius:4px;padding:1px 6px;font-size:10px;margin:2px;font-family:'JetBrains Mono',monospace;color:var(--muted)}
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.stat-ul{list-style:none;margin:0;padding:0}
.stat-li{display:grid;grid-template-columns:1fr auto;gap:3px;border-bottom:1px solid var(--s2);padding:7px 0}
.stat-li small{grid-column:1/-1;color:var(--muted);font-size:10px;font-family:'JetBrains Mono',monospace}
.sidebar-footer{margin-top:auto;padding-top:10px;border-top:1px solid var(--line)}
.sidebar-footer-lbl{font-size:10px;color:var(--muted);font-family:'JetBrains Mono',monospace;padding:4px 10px;text-transform:uppercase;letter-spacing:.08em}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
section{animation:fadeUp .38s ease both}
section:nth-child(2){animation-delay:.05s}section:nth-child(3){animation-delay:.10s}
section:nth-child(4){animation-delay:.15s}section:nth-child(5){animation-delay:.20s}
section:nth-child(6){animation-delay:.25s}section:nth-child(7){animation-delay:.30s}
@media(max-width:900px){.sidebar{display:none}.main{margin-left:0;padding:70px 16px 40px}.bento{grid-template-columns:1fr 1fr}.bento-hero{grid-column:span 2}.hotspots,.stat-grid{grid-template-columns:1fr}.export-bar{left:0}}
.export-bar{position:fixed;bottom:0;left:220px;right:0;z-index:60;background:rgba(9,9,11,.97);border-top:1px solid var(--line);backdrop-filter:blur(16px);padding:10px 28px;display:flex;align-items:center;gap:10px;transform:translateY(100%);transition:transform .25s cubic-bezier(.4,0,.2,1)}
.export-bar.visible{transform:translateY(0)}
.sel-count{color:var(--primary);font-weight:700;font-family:'JetBrains Mono',monospace;font-size:12px;min-width:110px}
.btn{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:7px;font-size:12px;font-family:'JetBrains Mono',monospace;cursor:pointer;transition:all .15s;border:1px solid var(--line);white-space:nowrap;font-weight:500}
.btn-primary{background:var(--primary);color:var(--primary-on);border-color:var(--primary);font-weight:700}
.btn-primary:hover{opacity:.86}
.btn-ghost{background:transparent;color:var(--dim)}
.btn-ghost:hover{background:var(--s3);color:var(--text)}
.btn-danger{background:transparent;color:var(--critical);border-color:var(--crit-border)}
.btn-danger:hover{background:var(--crit-dim)}
input[type=checkbox]{width:14px;height:14px;accent-color:var(--primary);cursor:pointer;vertical-align:middle}
.copy-btn{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:5px;font-size:10px;font-family:'JetBrains Mono',monospace;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--muted);transition:all .12s;margin-left:auto;flex-shrink:0}
.copy-btn:hover{color:var(--text);border-color:var(--muted);background:var(--s3)}
.toast{position:fixed;bottom:72px;left:50%;transform:translateX(-50%) translateY(10px);background:var(--s4);border:1px solid var(--primary);border-radius:8px;padding:9px 20px;font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--primary);opacity:0;pointer-events:none;transition:all .25s;z-index:300;white-space:nowrap;box-shadow:0 4px 20px rgba(163,255,71,.12)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:200;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .2s;backdrop-filter:blur(8px)}
.modal-overlay.open{opacity:1;pointer-events:all}
.modal{background:var(--s1);border:1px solid var(--line);border-radius:14px;padding:24px;width:min(700px,92vw);max-height:84vh;display:flex;flex-direction:column;gap:14px;box-shadow:0 32px 80px rgba(0,0,0,.7)}
.modal h3{margin:0;font-size:13px;color:var(--primary);font-family:'JetBrains Mono',monospace;font-weight:700;letter-spacing:.02em}
.modal-hdr{display:flex;align-items:center;justify-content:space-between}
.modal textarea{background:var(--s2);border:1px solid var(--line);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.7;padding:14px;resize:vertical;min-height:280px;width:100%;outline:none;transition:border-color .12s}
.modal textarea:focus{border-color:var(--primary)}
.modal-footer{display:flex;gap:8px;justify-content:flex-end}
.row-selected>td{background:rgba(163,255,71,.04)!important}
tr:hover td{background:rgba(255,255,255,.012)}
.sec-hdr{display:flex;align-items:center;gap:10px;margin-bottom:16px;border-bottom:1px solid var(--line);padding-bottom:10px}
.sec-hdr h2{margin:0;border:none;padding:0;flex:1}
.sec-hdr-btns{display:flex;gap:6px}
@media print{
  /* Every rule above is built on these custom properties, so redefining them for
     light/print output fixes tables, cards, and pills in one place — patching each
     selector individually (background/border only, never text) left th/td/h3 text
     colors tuned for a dark surface unreadable once that surface went white. */
  :root{--bg:#fff;--s1:#f9f9f9;--s2:#f0f0f0;--s3:#e8e8e8;--s4:#e0e0e0;--line:#ccc;--text:#111;--muted:#555;--dim:#333}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .header,.sidebar,.export-bar,.modal-overlay,.filters,.sec-hdr-btns,.copy-btn,#select-all-cb,.row-cb{display:none!important}
  .main{margin-left:0;padding:10px}
  section{animation:none;page-break-inside:avoid}
  a{color:#000}
}
`;
