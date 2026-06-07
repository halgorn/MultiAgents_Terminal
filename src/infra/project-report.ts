import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildApiMap, auditEnvVars, measureCognitiveLoad, scanCurrentSecrets } from './code-metrics.js';
import { buildSbom } from './sbom.js';
import { buildChurnReport } from './git-analysis.js';
import { detectPatterns } from './pattern-detect.js';
import { computeHealthScore } from './health-score.js';
import { GraphAgent } from '../agents/graph-agent.js';
import type { AuditFinding, AuditReport } from '../schemas/audit.js';
import { SEVERITY_RANK } from './audit-model.js';

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Original report functions ─────────────────────────────────────────────────

export function latestAuditPointer(cwd: string): { runDir?: string; html?: string; digest?: string; aiContext?: string; report?: string; createdAt?: string } | null {
  try {
    const path = join(cwd, '.ai-runtime', 'reports', 'latest-audit.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
}

export function loadLatestAudit(cwd: string): AuditReport | null {
  const dir = join(cwd, '.ai-runtime', 'reports');
  if (!existsSync(dir)) return null;
  try {
    const pointer = latestAuditPointer(cwd);
    const reportPath = pointer?.report ?? (pointer?.runDir ? join(pointer.runDir, 'report.json') : undefined);
    if (reportPath && existsSync(reportPath)) return JSON.parse(readFileSync(reportPath, 'utf8')) as AuditReport;
    const files = readdirSync(dir).filter((f) => f.startsWith('audit-') && f.endsWith('.json')).sort().reverse();
    return files[0] ? JSON.parse(readFileSync(join(dir, files[0]), 'utf8')) as AuditReport : null;
  } catch { return null; }
}

export async function buildProjectReportData(cwd: string, days: number) {
  const projectName = cwd.split('/').pop() ?? 'project';
  const graph = new GraphAgent(cwd);
  const index = await graph.ensureIndex();
  let hotspots: Array<{ file: string; fanIn: number; fanOut: number }> = [];
  let cycles = 0;
  try {
    const { detectLang } = await import('./lang-detect.js');
    const { buildDepGraphAuto } = await import('./dep-graph.js');
    const lang = detectLang(cwd);
    const dep = buildDepGraphAuto(cwd, lang.lang);
    hotspots = dep.hotspots;
    cycles = dep.cycles.length;
  } catch { /* best-effort */ }
  const audit = loadLatestAudit(cwd);
  const churn = buildChurnReport(cwd, hotspots.map((h) => h.file), days);
  const patterns = detectPatterns(cwd, hotspots);
  const cognitive = measureCognitiveLoad(cwd, 30);
  const apiEndpoints = buildApiMap(cwd);
  const envAudit = auditEnvVars(cwd);
  const secrets = scanCurrentSecrets(cwd);
  const sbom = buildSbom(cwd);
  const health = computeHealthScore({
    totalFiles: index.stats.files,
    totalSymbols: index.stats.symbols,
    cycles,
    hotspots: hotspots.length,
    testFileRatio: index.files.filter((f) => f.isTest).length / Math.max(index.files.length, 1),
    churn: churn.churn,
    busFactor: churn.busFactor,
    cognitiveLoad: cognitive,
    patterns,
    auditCriticals: audit?.criticalCount,
    auditHighs: audit?.highCount,
  });
  return { projectName, health, audit, churn, patterns, cognitive, generatedAt: new Date().toLocaleString(),
    totalFiles: index.stats.files, totalSymbols: index.stats.symbols, cycles, hotspots, apiEndpoints, envAudit, secrets, sbom };
}

export function renderProjectMarkdown(data: Awaited<ReturnType<typeof buildProjectReportData>>): string {
  const lines: string[] = [];
  lines.push(`# ${data.projectName} - AI Analysis Context`);
  lines.push(`> Generated: ${data.generatedAt}. Use this compact project report for architecture and improvement analysis.`);
  lines.push('', `## Health Score: ${data.health.total}/100 (${data.health.grade})`, '');
  lines.push('| Dimension | Score | Detail |', '|---|---|---|');
  data.health.dimensions.forEach((d) => lines.push(`| ${d.name} | ${d.score}/100 | ${d.detail} |`));
  lines.push('', '## Project Overview');
  lines.push(`- Files: ${data.totalFiles}`);
  lines.push(`- Symbols: ${data.totalSymbols}`);
  lines.push(`- Dependency cycles: ${data.cycles}`);
  lines.push(`- Git commits (${data.churn.periodDays}d): ${data.churn.totalCommits}`, '');
  if (data.health.topRisks.length > 0) {
    lines.push('## Top Risks', ...data.health.topRisks.map((r) => `- ${r}`), '');
  }
  if (data.audit) {
    lines.push('## Latest Audit');
    lines.push(`- Critical: ${data.audit.criticalCount}`);
    lines.push(`- High: ${data.audit.highCount}`);
    lines.push(`- Total findings: ${data.audit.findings.length}`);
    lines.push('', data.audit.summary, '');
    data.audit.findings.filter((f) => ['critical', 'high'].includes(f.severity)).slice(0, 20).forEach((f) => {
      lines.push(`- ${f.severity} ${f.file}${f.line ? ':' + f.line : ''} [${f.category}] ${f.finding}`);
    });
    lines.push('');
  }
  if (data.hotspots.length > 0) {
    lines.push('## Hotspot Files', '| File | FanIn | FanOut |', '|---|---|---|');
    data.hotspots.slice(0, 15).forEach((h) => lines.push(`| ${h.file} | ${h.fanIn} | ${h.fanOut} |`));
    lines.push('');
  }
  if (data.cognitive.length > 0) {
    lines.push('## High Cognitive Load', '| File | Score | LOC |', '|---|---|---|');
    data.cognitive.slice(0, 12).forEach((c) => lines.push(`| ${c.file} | ${c.score} | ${c.loc} |`));
    lines.push('');
  }
  if (data.patterns.antiPatterns.length > 0) {
    lines.push('## Anti-Patterns', ...data.patterns.antiPatterns.map((a) => `- ${a.name} [${a.severity}]: ${a.description}`), '');
  }
  if (data.envAudit.undocumented.length > 0) {
    lines.push('## Undocumented Env Vars', ...data.envAudit.undocumented.slice(0, 20).map((v) => `- ${v}`), '');
  }
  if (data.secrets.length > 0) {
    lines.push('## Hardcoded Secrets', ...data.secrets.map((s) => `- ${s.file}:${s.line} [${s.pattern}]`), '');
  }
  if (data.sbom.unpinned.length > 0) {
    lines.push('## Unpinned Dependencies', ...data.sbom.unpinned.slice(0, 20).map((p) => `- ${p.lang} ${p.name} ${p.version}`), '');
  }
  lines.push('## Suggested Prompts');
  lines.push('- Based on this analysis, create a prioritized refactoring roadmap.');
  lines.push('- Which findings should be fixed first and why?');
  lines.push('- Which files should be split to reduce maintenance risk?');
  return lines.join('\n');
}

export function renderProjectHtml(data: Awaited<ReturnType<typeof buildProjectReportData>>, graphExists: boolean): string {
  const gradeColor = { A: '#3fb950', B: '#3fb950', C: '#e3b341', D: '#f85149', F: '#f85149' }[data.health.grade] ?? '#8b949e';
  const findingRows = (data.audit?.findings ?? []).slice(0, 50).map((f) => `<tr><td>${esc(f.severity)}</td><td class="mono">${esc(f.file)}${f.line ? ':' + f.line : ''}</td><td>${esc(f.category)}</td><td>${esc(f.finding)}</td></tr>`).join('');
  const churnRows = data.churn.churn.slice(0, 20).map((c) => `<tr><td class="mono">${esc(c.file)}</td><td>${c.commits}</td><td>${c.authors}</td><td>${esc(c.risk)}</td></tr>`).join('');
  const cogRows = data.cognitive.slice(0, 15).map((c) => `<tr><td class="mono">${esc(c.file)}</td><td>${c.score}</td><td>${c.maxNesting}</td><td>${c.longFunctions}</td><td>${c.loc}</td></tr>`).join('');
  const dimBars = data.health.dimensions.map((d) => `<div class="dim-row"><div>${esc(d.name)}</div><div class="bar"><div style="width:${d.score}%;background:${d.score >= 80 ? '#3fb950' : d.score >= 60 ? '#e3b341' : '#f85149'}"></div></div><strong>${d.score}</strong><small>${esc(d.detail)}</small></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.projectName)} - Project Report</title><style>
body{background:#0d1117;color:#e6edf3;font:14px/1.55 system-ui,sans-serif;margin:0}nav{position:sticky;top:0;background:#161b22;border-bottom:1px solid #30363d;padding:12px 24px;display:flex;gap:18px}a{color:#79c0ff;text-decoration:none}.container{max-width:1200px;margin:auto;padding:24px}.header{border:1px solid #30363d;background:#161b22;border-radius:8px;padding:22px;display:flex;justify-content:space-between}.score{font-size:56px;font-weight:700;color:${gradeColor}}h2{color:#79c0ff;border-bottom:1px solid #30363d;padding-bottom:8px;margin-top:34px}.dim-row{display:grid;grid-template-columns:140px 1fr 40px 1fr;gap:12px;margin:7px 0}.bar{background:#21262d;height:8px;border-radius:4px}.bar div{height:8px;border-radius:4px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #21262d;padding:8px;text-align:left;vertical-align:top}@media(max-width:800px){.grid,.dim-row{grid-template-columns:1fr}.header{display:block}}
</style></head><body><nav><a href="#health">Health</a><a href="#audit">Audit</a><a href="#churn">Churn</a><a href="#complexity">Complexity</a>${graphExists ? '<a href="graph.html">Graph</a>' : ''}</nav><main class="container">
<section class="header"><div><h1>${esc(data.projectName)}</h1><p>Generated ${esc(data.generatedAt)} · ${data.audit ? `${data.audit.totalFiles} files audited` : 'no audit data'}</p></div><div class="score">${data.health.total} ${data.health.grade}</div></section>
<section id="health"><h2>Health</h2>${dimBars}</section>
${data.audit ? `<section id="audit"><h2>Audit</h2><div class="grid"><div class="card"><strong>${data.audit.findings.length}</strong><br>Findings</div><div class="card"><strong>${data.audit.criticalCount}</strong><br>Critical</div><div class="card"><strong>${data.audit.highCount}</strong><br>High</div></div><p>${esc(data.audit.summary)}</p><table><tr><th>Severity</th><th>Location</th><th>Category</th><th>Finding</th></tr>${findingRows}</table></section>` : ''}
${data.churn.churn.length ? `<section id="churn"><h2>Churn</h2><table><tr><th>File</th><th>Commits</th><th>Authors</th><th>Risk</th></tr>${churnRows}</table></section>` : ''}
${data.cognitive.length ? `<section id="complexity"><h2>Complexity</h2><table><tr><th>File</th><th>Score</th><th>Nesting</th><th>Long Functions</th><th>LOC</th></tr>${cogRows}</table></section>` : ''}
</main></body></html>`;
}

export function writeProjectReport(cwd: string, data: Awaited<ReturnType<typeof buildProjectReportData>>, mdOnly: boolean): { mdFile: string; htmlFile?: string; md: string } {
  const outDir = join(cwd, '.ai-runtime');
  mkdirSync(outDir, { recursive: true });
  const md = renderProjectMarkdown(data);
  const mdFile = join(outDir, 'context.md');
  writeFileSync(mdFile, md, 'utf8');
  if (mdOnly) return { mdFile, md };
  const htmlFile = join(outDir, 'report.html');
  writeFileSync(htmlFile, renderProjectHtml(data, existsSync(join(outDir, 'graph.html'))), 'utf8');
  return { mdFile, htmlFile, md };
}

// ── Accumulated project audit report (tabs por domínio) ───────────────────────

export interface DomainSnapshot {
  domain: string;
  scannedAt: string;
  findings: AuditFinding[];
  summary: string;
  totalFiles: number;
}

function domainsDir(cwd: string): string {
  return join(cwd, '.ai-runtime', 'reports', 'domains');
}

export function projectReportPath(cwd: string): string {
  return join(cwd, '.ai-runtime', 'reports', 'project.html');
}

export function saveDomainSnapshot(cwd: string, report: AuditReport): void {
  const dir = domainsDir(cwd);
  mkdirSync(dir, { recursive: true });
  const sections = report.sections ?? [];
  const now = new Date().toISOString();

  if (sections.length > 0) {
    for (const section of sections) {
      const snapshot: DomainSnapshot = {
        domain: section.domain,
        scannedAt: now,
        findings: section.findings,
        summary: section.summary,
        totalFiles: report.totalFiles,
      };
      writeFileSync(join(dir, `${section.domain}.json`), JSON.stringify(snapshot, null, 2), 'utf8');
    }
  } else {
    const byCategory = new Map<string, AuditFinding[]>();
    for (const f of report.findings) {
      if (!byCategory.has(f.category)) byCategory.set(f.category, []);
      byCategory.get(f.category)!.push(f);
    }
    for (const [cat, findings] of byCategory) {
      const snapshot: DomainSnapshot = { domain: cat, scannedAt: now, findings, summary: report.summary, totalFiles: report.totalFiles };
      writeFileSync(join(dir, `${cat}.json`), JSON.stringify(snapshot, null, 2), 'utf8');
    }
  }

  rebuildProjectHtml(cwd);
}

function loadAllDomains(cwd: string): DomainSnapshot[] {
  const dir = domainsDir(cwd);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')) as DomainSnapshot; } catch { return null; } })
      .filter((d): d is DomainSnapshot => d !== null)
      .sort((a, b) => a.domain.localeCompare(b.domain));
  } catch { return []; }
}

const DOMAIN_LABELS: Record<string, string> = {
  security: '🔐 Segurança',
  bugs: '🐛 Bugs',
  'error-handling': '⚠️ Error Handling',
  architecture: '🏗️ Arquitetura',
  testing: '🧪 Testes',
  performance: '⚡ Performance',
  observability: '📊 Observabilidade',
  resilience: '🛡️ Resiliência',
  compliance: '📋 Compliance',
  dependencies: '📦 Dependências',
  infrastructure: '🛠️ Infraestrutura',
  data: '🗄️ Dados',
  multitenancy: '🏢 Multitenancy',
  redundancy: '♻️ Redundância',
  'prompt-audit': '🤖 Prompt Audit',
};

function severityBadge(sev: string): string {
  return `<span class="badge sev-${esc(sev)}">${esc(sev)}</span>`;
}

function renderDomainTab(snap: DomainSnapshot, index: number): string {
  const sorted = [...snap.findings].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
  const critical = sorted.filter((f) => f.severity === 'critical').length;
  const high = sorted.filter((f) => f.severity === 'high').length;
  const ago = Math.round((Date.now() - new Date(snap.scannedAt).getTime()) / 60000);
  const agoStr = ago < 60 ? `${ago}m atrás` : `${Math.round(ago / 60)}h atrás`;

  const rows = sorted.map((f, i) => `
    <tr>
      <td class="idx">#${i + 1}</td>
      <td>${severityBadge(f.severity)}</td>
      <td><code class="loc">${esc(f.file)}${f.line ? `:${f.line}` : ''}</code></td>
      <td>${esc(f.finding)}<div class="rec">${esc(f.recommendation)}</div></td>
    </tr>`).join('');

  return `<div class="tab-panel" id="panel-${index}" role="tabpanel">
  <div class="domain-meta">
    <span class="muted">Escaneado ${esc(agoStr)} · ${snap.totalFiles} arquivos · ${sorted.length} finding${sorted.length !== 1 ? 's' : ''}</span>
    ${critical > 0 ? `${severityBadge('critical')} ${critical}` : ''}
    ${high > 0 ? `${severityBadge('high')} ${high}` : ''}
  </div>
  <p class="summary muted">${esc(snap.summary)}</p>
  ${sorted.length === 0
    ? '<p class="muted">Nenhum finding neste domínio. ✓</p>'
    : `<table><thead><tr><th>#</th><th>Severity</th><th>Localização</th><th>Finding &amp; Recomendação</th></tr></thead><tbody>${rows}</tbody></table>`}
</div>`;
}

export function rebuildProjectHtml(cwd: string): void {
  const domains = loadAllDomains(cwd);
  const projectName = cwd.split('/').pop() ?? cwd;

  const tabButtons = domains.map((snap, i) => {
    const label = DOMAIN_LABELS[snap.domain] ?? snap.domain;
    const critical = snap.findings.filter((f) => f.severity === 'critical').length;
    const high = snap.findings.filter((f) => f.severity === 'high').length;
    const badge = critical > 0
      ? `<span class="tbadge tcrit">${critical}</span>`
      : high > 0 ? `<span class="tbadge thigh">${high}</span>` : '';
    return `<button class="tab-btn${i === 0 ? ' active' : ''}" onclick="switchTab(${i})">${esc(label)}${badge}</button>`;
  }).join('');

  const panels = domains.map((snap, i) => renderDomainTab(snap, i)).join('');
  const totalCrit = domains.reduce((s, d) => s + d.findings.filter((f) => f.severity === 'critical').length, 0);
  const totalHigh = domains.reduce((s, d) => s + d.findings.filter((f) => f.severity === 'high').length, 0);
  const totalFindings = domains.reduce((s, d) => s + d.findings.length, 0);

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aion · ${esc(projectName)}</title><style>
:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--blue:#79c0ff;--yellow:#e3b341;--red:#f85149;--green:#3fb950}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif}
a{color:var(--blue)}code{font-family:ui-monospace,Menlo,monospace}
.header{padding:16px 28px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.header h1{margin:0;font-size:16px}.muted{color:var(--muted);font-size:12px}
.stats{display:flex;gap:20px}.stat .num{font-size:20px;font-weight:700;line-height:1}.stat .lbl{font-size:11px;color:var(--muted)}
.badge{display:inline-flex;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;text-transform:uppercase}
.sev-critical{background:#f8514920;color:var(--red)}.sev-high{background:#e3b34120;color:var(--yellow)}
.sev-medium{background:#79c0ff20;color:var(--blue)}.sev-low,.sev-info{background:#8b949e20;color:var(--muted)}
.tabs{display:flex;gap:2px;padding:12px 28px 0;border-bottom:1px solid var(--line);overflow-x:auto}
.tab-btn{background:none;border:1px solid transparent;color:var(--muted);padding:7px 13px;cursor:pointer;border-radius:6px 6px 0 0;font-size:13px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.tab-btn:hover{color:var(--text)}.tab-btn.active{color:var(--blue);background:var(--panel);border-color:var(--line);border-bottom-color:var(--panel);margin-bottom:-1px}
.tbadge{border-radius:9px;padding:1px 5px;font-size:10px;font-weight:700;color:#fff}.tcrit{background:var(--red)}.thigh{background:var(--yellow);color:#000}
.tab-panel{display:none;padding:20px 28px}.tab-panel.active{display:block}
.domain-meta{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.summary{margin:0 0 14px;max-width:900px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:6px;overflow:hidden}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid #21262d;padding:8px 10px}th{color:var(--muted);font-size:12px}
.idx{font-size:11px;width:30px;color:var(--muted)}.loc{font-size:11px}.rec{color:var(--muted);font-size:12px;margin-top:3px}
.empty{padding:60px 28px;color:var(--muted);text-align:center;font-size:15px}
</style></head><body>
<div class="header">
  <div>
    <h1>🤖 Aion &nbsp;·&nbsp; ${esc(projectName)}</h1>
    <span class="muted">${domains.length} domínio${domains.length !== 1 ? 's' : ''} escaneado${domains.length !== 1 ? 's' : ''} · atualizado ${new Date().toLocaleString('pt-BR')}</span>
  </div>
  <div class="stats">
    <div class="stat"><div class="num" style="color:var(--red)">${totalCrit}</div><div class="lbl">Critical</div></div>
    <div class="stat"><div class="num" style="color:var(--yellow)">${totalHigh}</div><div class="lbl">High</div></div>
    <div class="stat"><div class="num">${totalFindings}</div><div class="lbl">Findings</div></div>
    <div class="stat"><div class="num">${domains.length}</div><div class="lbl">Domínios</div></div>
  </div>
</div>
${domains.length === 0
  ? '<div class="empty">Nenhum scan realizado ainda.<br><br><code>aion</code> → escolha uma categoria para começar.</div>'
  : `<div class="tabs">${tabButtons}</div>${panels}`}
<script>
function switchTab(i){
  document.querySelectorAll('.tab-btn').forEach((b,j)=>b.classList.toggle('active',j===i));
  document.querySelectorAll('.tab-panel').forEach((p,j)=>p.classList.toggle('active',j===i));
}
var first=document.querySelector('.tab-panel');if(first)first.classList.add('active');
</script></body></html>`;

  writeFileSync(projectReportPath(cwd), html, 'utf8');
}
