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


const PROJECT_DOMAIN_ICONS: Record<string, string> = {
  security: 'shield', bugs: 'bug_report', 'error-handling': 'error',
  architecture: 'architecture', testing: 'terminal', performance: 'speed',
  observability: 'visibility', resilience: 'verified_user', compliance: 'gavel',
  dependencies: 'link', infrastructure: 'dns', data: 'database',
  multitenancy: 'group', redundancy: 'recycling', 'prompt-audit': 'psychology', local: 'home',
};

const PROJECT_DOMAIN_NAMES: Record<string, string> = {
  security: 'Segurança', bugs: 'Bugs', 'error-handling': 'Error Handling',
  architecture: 'Arquitetura', testing: 'Testes', performance: 'Performance',
  observability: 'Observabilidade', resilience: 'Resiliência', compliance: 'Compliance',
  dependencies: 'Dependências', infrastructure: 'Infraestrutura', data: 'Dados',
  multitenancy: 'Multitenancy', redundancy: 'Redundância', 'prompt-audit': 'Prompt Audit', local: 'Local',
};

const PROJECT_CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{--bg:#101419;--surface:#1c2025;--surface-low:#181c21;--surface-high:#272a30;--surface-highest:#32353b;--line:#414752;--text:#e0e2ea;--muted:#8b919d;--dim:#c0c7d4;--primary:#a2c9ff;--primary-btn:#58a6ff;--primary-on:#00315c;--critical:#ffb4ab;--high:#ffba42;--green:#3fb950}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:14px;line-height:1.5}
a{color:var(--primary);text-decoration:none}code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px}button{cursor:pointer}
.ms{font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;vertical-align:middle;user-select:none}
.header{position:fixed;top:0;left:0;width:100%;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:0 24px;height:64px;border-bottom:1px solid var(--line);background:rgba(16,20,25,.85);backdrop-filter:blur(12px)}
.brand{font-size:22px;font-weight:900;color:var(--primary);letter-spacing:-.02em}
.sidebar{position:fixed;left:0;top:0;height:100%;width:260px;display:flex;flex-direction:column;padding:80px 16px 16px;background:var(--surface-low);border-right:1px solid var(--line);z-index:40;overflow:hidden}
.sidebar-nav{flex:1;display:flex;flex-direction:column;gap:4px;overflow-y:auto;padding-right:4px}
.sidebar-nav::-webkit-scrollbar{width:3px}.sidebar-nav::-webkit-scrollbar-thumb{background:var(--line);border-radius:2px}
.tab-btn{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;width:100%;text-align:left;background:none;border:none;color:var(--dim);font-size:13px;font-family:'JetBrains Mono',monospace;transition:background .15s,color .15s}
.tab-btn:hover{background:var(--surface-high);color:var(--text)}.tab-btn.active{background:rgba(162,201,255,.12);color:var(--primary)}
.sidebar-footer{margin-top:auto;padding-top:16px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:2px}
.sidebar-lbl{padding:4px 12px;font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace}
.sidebar-link{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;color:var(--muted);font-size:13px;transition:all .15s}
.sidebar-link:hover{color:var(--text);background:var(--surface-high)}
.main{margin-left:260px;padding:88px 24px 24px;display:flex;flex-direction:column;gap:24px}
.bento{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px}
.bento-hero{background:var(--surface-low);border:1px solid var(--line);border-radius:16px;padding:24px;display:flex;flex-direction:column;justify-content:center;position:relative;overflow:hidden}
.bento-hero::before{content:'';position:absolute;top:-64px;right:-64px;width:256px;height:256px;background:rgba(162,201,255,.04);border-radius:50%;filter:blur(48px)}
.bento-hero h1{margin:0;font-size:26px;font-weight:900;color:var(--text);position:relative;z-index:1}
.bento-hero p{margin:8px 0 0;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;font-family:'JetBrains Mono',monospace;position:relative;z-index:1}
.bento-stat{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px;display:flex;flex-direction:column;justify-content:space-between}
.bento-stat-lbl{font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.bento-num{font-size:36px;font-weight:700;color:var(--text);margin-top:16px}
.bento-crit{background:rgba(255,180,171,.06);border:1px solid rgba(255,180,171,.2);border-radius:16px;padding:16px;display:flex;flex-direction:column;justify-content:space-between}
.bento-crit-num{font-size:36px;font-weight:700;color:var(--critical);margin-top:16px}
.panel{display:none;flex-direction:column;gap:16px}.panel.active{display:flex}
.panel-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:12px;flex-wrap:wrap;gap:8px}
.panel-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.panel-title h2{margin:0;font-size:20px;font-weight:700;color:var(--text)}
.pill{display:inline-flex;align-items:center;padding:2px 10px;border-radius:999px;font-size:12px;font-family:'JetBrains Mono',monospace}
.pill-neutral{background:var(--surface-high);color:var(--dim)}
.pill-crit{background:rgba(255,180,171,.12);color:var(--critical);border:1px solid rgba(255,180,171,.3)}
.pill-high{background:rgba(255,186,66,.12);color:var(--high);border:1px solid rgba(255,186,66,.3)}
.cards{display:flex;flex-direction:column;gap:12px}
.card{background:var(--surface-low);border:1px solid var(--line);border-radius:12px;padding:16px;position:relative;transition:border-color .15s}
.card:hover{border-color:var(--muted)}
.card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:12px 0 0 12px}
.card.sev-critical::before{background:var(--critical)}.card.sev-high::before{background:var(--high)}.card.sev-medium::before{background:var(--primary)}.card.sev-low::before,.card.sev-info::before{background:var(--muted)}
.card-body{padding-left:12px;display:flex;gap:16px;align-items:flex-start}
.card-content{flex:1;display:flex;flex-direction:column;gap:8px}
.card-title-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.card-title{margin:0;font-size:15px;font-weight:600;color:var(--text);line-height:1.4}
.sev-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700}
.sev-badge.sev-critical{background:rgba(255,180,171,.12);color:var(--critical);border:1px solid rgba(255,180,171,.3)}
.sev-badge.sev-high{background:rgba(255,186,66,.12);color:var(--high);border:1px solid rgba(255,186,66,.3)}
.sev-badge.sev-medium{background:rgba(162,201,255,.12);color:var(--primary);border:1px solid rgba(162,201,255,.3)}
.sev-badge.sev-low,.sev-badge.sev-info{background:rgba(139,145,157,.15);color:var(--muted);border:1px solid rgba(139,145,157,.2)}
.card-loc{display:inline-flex;align-items:center;gap:6px;background:var(--bg);padding:3px 10px;border-radius:6px;border:1px solid var(--line);max-width:100%;overflow:hidden}
.card-loc code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dim)}
.card-rec{margin:0;font-size:13px;color:var(--dim);line-height:1.5}
.copy-btn{flex-shrink:0;padding:8px;color:var(--muted);background:transparent;border:1px solid transparent;border-radius:8px;transition:all .15s;font-family:'Material Symbols Outlined'}
.copy-btn:hover{color:var(--primary);background:rgba(162,201,255,.1);border-color:rgba(162,201,255,.3)}
.copy-all-btn{display:flex;align-items:center;gap:6px;padding:6px 14px;background:var(--primary-btn);color:var(--primary-on);border:none;border-radius:8px;font-size:13px;font-family:'JetBrains Mono',monospace;transition:opacity .15s}
.copy-all-btn:hover{opacity:.85}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:96px 24px;background:var(--surface-low);border:1px solid var(--line);border-radius:16px;color:var(--muted)}
.mobile-bar{display:none;position:fixed;bottom:0;left:0;width:100%;background:var(--surface-low);border-top:1px solid var(--line);padding:8px 16px;z-index:50;gap:4px;overflow-x:auto}
.mob-btn{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 12px;border-radius:8px;background:none;border:none;color:var(--muted);font-size:10px;font-family:'JetBrains Mono',monospace;white-space:nowrap;transition:color .15s}
.mob-btn.active{color:var(--primary)}
@media(max-width:768px){.sidebar{display:none}.main{margin-left:0;padding-bottom:80px}.mobile-bar{display:flex}.bento{grid-template-columns:1fr 1fr}.bento-hero{grid-column:span 2}}
@media(max-width:480px){.bento{grid-template-columns:1fr}.bento-hero{grid-column:span 1}}
`;

export function rebuildProjectHtml(cwd: string): void {
  const domains = loadAllDomains(cwd);
  const projectName = cwd.split('/').pop() ?? cwd;
  const totalCrit = domains.reduce((s, d) => s + d.findings.filter((f) => f.severity === 'critical').length, 0);
  const totalHigh = domains.reduce((s, d) => s + d.findings.filter((f) => f.severity === 'high').length, 0);
  const totalFindings = domains.reduce((s, d) => s + d.findings.length, 0);
  const dateStr = new Date().toLocaleDateString('pt-BR');

  const sidebarItems = domains.map((snap, i) => {
    const icon = PROJECT_DOMAIN_ICONS[snap.domain] ?? 'search';
    const name = PROJECT_DOMAIN_NAMES[snap.domain] ?? snap.domain;
    const crit = snap.findings.filter((f) => f.severity === 'critical').length;
    const high = snap.findings.filter((f) => f.severity === 'high').length;
    const count = snap.findings.length;
    const badgeStyle = crit > 0
      ? 'background:rgba(255,180,171,.2);color:#ffb4ab'
      : high > 0 ? 'background:rgba(255,186,66,.2);color:#ffba42' : 'background:#272a30;color:#c0c7d4';
    return `<button onclick="switchTab(${i})" class="tab-btn" data-idx="${i}">
  <span class="ms material-symbols-outlined" style="font-size:20px">${esc(icon)}</span>
  ${esc(name)}
  <span class="ml-auto" style="margin-left:auto;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;${badgeStyle}">${count}</span>
</button>`;
  }).join('\n');

  const panels = domains.map((snap, i) => {
    const sorted = [...snap.findings].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
    const name = PROJECT_DOMAIN_NAMES[snap.domain] ?? snap.domain;
    const icon = PROJECT_DOMAIN_ICONS[snap.domain] ?? 'search';
    const crit = sorted.filter((f) => f.severity === 'critical').length;
    const high = sorted.filter((f) => f.severity === 'high').length;
    const ago = Math.round((Date.now() - new Date(snap.scannedAt).getTime()) / 60000);
    const agoStr = ago < 60 ? `${ago}m atrás` : `${Math.round(ago / 60)}h atrás`;

    const cards = sorted.length === 0
      ? `<div class="empty" style="padding:48px 24px"><span class="ms material-symbols-outlined" style="font-size:48px;color:#3fb950;font-variation-settings:'FILL' 1">check_circle</span><p style="margin:12px 0 0;font-size:15px">Nenhum finding neste domínio.</p></div>`
      : sorted.map((f) => {
          const loc = f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : '';
          const copyData = esc(`${f.severity.toUpperCase()}: ${f.finding}${loc ? ' — ' + loc : ''}${f.recommendation ? '\nRecomendação: ' + f.recommendation : ''}`);
          return `<article class="card sev-${esc(f.severity)}">
  <div class="card-body">
    <div class="card-content">
      <div class="card-title-row">
        <span class="sev-badge sev-${esc(f.severity)}">${esc(f.severity.toUpperCase())}</span>
        <h3 class="card-title">${esc(f.finding)}</h3>
      </div>
      ${loc ? `<div class="card-loc"><span class="ms material-symbols-outlined" style="font-size:16px;color:#8b919d">folder</span><code>${esc(loc)}</code></div>` : ''}
      ${f.recommendation ? `<p class="card-rec">${esc(f.recommendation)}</p>` : ''}
    </div>
    <button onclick="copyFinding(this)" data-text="${copyData}" class="copy-btn" title="Copiar">
      <span class="ms material-symbols-outlined">content_copy</span>
    </button>
  </div>
</article>`;
        }).join('\n');

    const critBadge = crit > 0 ? `<span class="pill pill-crit">${crit} critical</span>` : '';
    const highBadge = high > 0 ? `<span class="pill pill-high">${high} high</span>` : '';

    return `<div class="panel" id="panel-${i}">
  <div class="panel-header">
    <div class="panel-title">
      <span class="ms material-symbols-outlined" style="font-size:28px;color:#a2c9ff;font-variation-settings:'FILL' 1">${esc(icon)}</span>
      <h2>${esc(name)}</h2>
      <span class="pill pill-neutral">${sorted.length} total</span>
      ${critBadge}${highBadge}
    </div>
    <span style="display:flex;align-items:center;gap:6px;color:#8b919d;font-size:12px;font-family:'JetBrains Mono',monospace">
      <span class="ms material-symbols-outlined" style="font-size:16px">update</span>${esc(agoStr)}
    </span>
  </div>
  <div class="cards">${cards}</div>
</div>`;
  }).join('\n');

  const mobileBtns = domains.map((snap, i) => {
    const icon = PROJECT_DOMAIN_ICONS[snap.domain] ?? 'search';
    const name = PROJECT_DOMAIN_NAMES[snap.domain] ?? snap.domain;
    return `<button onclick="switchTab(${i})" class="mob-btn" data-idx="${i}"><span class="ms material-symbols-outlined" style="font-size:20px">${esc(icon)}</span>${esc(name)}</button>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width,initial-scale=1.0" name="viewport"/>
<title>Aion · ${esc(projectName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet"/>
<style>${PROJECT_CSS}</style>
</head>
<body>
<header class="header">
  <div style="display:flex;align-items:center;gap:12px">
    <span class="brand">Aion</span>
    <span style="color:#414752">·</span>
    <span style="font-size:14px;font-weight:600;color:#e0e2ea">${esc(projectName)}</span>
  </div>
  <button class="copy-all-btn" onclick="copyAllFindings()">
    <span class="ms material-symbols-outlined" style="font-size:18px">content_copy</span>Copiar todos
  </button>
</header>
<aside class="sidebar">
  <div style="margin-bottom:16px;padding:0 4px">
    <h2 style="margin:0;font-size:15px;font-weight:700;color:#e0e2ea">${esc(projectName)}</h2>
    <p style="margin:4px 0 0;font-size:12px;color:#8b919d;font-family:'JetBrains Mono',monospace">${esc(dateStr)}</p>
  </div>
  <nav class="sidebar-nav">
    ${domains.length === 0 ? '<p style="color:#8b919d;font-size:13px;padding:0 4px">Nenhum scan realizado.</p>' : sidebarItems}
  </nav>
  <div class="sidebar-footer">
    <span class="sidebar-lbl">Feedback &amp; Contato</span>
    <a href="mailto:brunoinacio30000@hotmail.com" class="sidebar-link">
      <span class="ms material-symbols-outlined" style="font-size:18px">mail</span>brunoinacio30000@hotmail.com
    </a>
    <a href="https://www.linkedin.com/in/bruno-inacio-036530170/" target="_blank" rel="noopener noreferrer" class="sidebar-link">
      <span class="ms material-symbols-outlined" style="font-size:18px">person</span>LinkedIn — Bruno Inácio
    </a>
  </div>
</aside>
<main class="main">
  <section class="bento">
    <div class="bento-hero">
      <h1>Relatório de Auditoria</h1>
      <p>
        <span class="ms material-symbols-outlined" style="font-size:16px">domain</span>
        ${domains.length} domínio${domains.length !== 1 ? 's' : ''} escaneado${domains.length !== 1 ? 's' : ''}
        &nbsp;·&nbsp;
        <span class="ms material-symbols-outlined" style="font-size:16px">update</span>
        ${esc(dateStr)}
      </p>
    </div>
    <div class="bento-stat">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <span class="bento-stat-lbl">Total Findings</span>
        <span class="ms material-symbols-outlined" style="color:#8b919d">bug_report</span>
      </div>
      <div class="bento-num">${totalFindings}</div>
    </div>
    <div class="bento-crit">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <span class="bento-stat-lbl" style="color:#ffb4ab">Critical</span>
        <span class="ms material-symbols-outlined" style="color:#ffb4ab">warning</span>
      </div>
      <div class="bento-crit-num">${totalCrit}</div>
    </div>
  </section>
  ${domains.length === 0
    ? `<div class="empty"><span class="ms material-symbols-outlined" style="font-size:64px">search_off</span><p style="margin:12px 0 0;font-size:18px;font-weight:600;color:#e0e2ea">Nenhum scan realizado ainda.</p><p style="margin:8px 0 0;font-size:14px">Execute <code style="background:#272a30;padding:2px 8px;border-radius:4px">aion</code> e escolha uma categoria.</p></div>`
    : panels}
</main>
<div class="mobile-bar">${mobileBtns}</div>
<script>
function switchTab(i){
  document.querySelectorAll('.tab-btn').forEach(function(b,j){b.classList.toggle('active',j===i);});
  document.querySelectorAll('.mob-btn').forEach(function(b,j){b.classList.toggle('active',j===i);});
  document.querySelectorAll('.panel').forEach(function(p,j){p.classList.toggle('active',j===i);});
}
function copyFinding(btn){
  navigator.clipboard.writeText(btn.getAttribute('data-text')).then(function(){
    var ic=btn.querySelector('.material-symbols-outlined');ic.textContent='check';
    setTimeout(function(){ic.textContent='content_copy';},1500);
  });
}
function copyAllFindings(){
  var panel=document.querySelector('.panel.active');if(!panel)return;
  var texts=Array.from(panel.querySelectorAll('[data-text]')).map(function(b){return b.getAttribute('data-text');});
  navigator.clipboard.writeText(texts.join('\n\n'));
}
if(${domains.length}>0)switchTab(0);
</script>
</body>
</html>`;

  writeFileSync(projectReportPath(cwd), html, 'utf8');
}
