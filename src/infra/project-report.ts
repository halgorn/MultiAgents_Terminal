import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildApiMap, auditEnvVars, measureCognitiveLoad, scanCurrentSecrets } from './code-metrics.js';
import { buildSbom } from './sbom.js';
import { buildChurnReport } from './git-analysis.js';
import { detectPatterns } from './pattern-detect.js';
import { computeHealthScore } from './health-score.js';
import { GraphAgent } from '../agents/graph-agent.js';
import type { AuditReport } from '../schemas/audit.js';

function esc(s: string): string {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function latestAuditPointer(cwd: string): { runDir?: string; html?: string; summary?: string; digest?: string; aiContext?: string; actionPlan?: string; report?: string; createdAt?: string } | null {
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
    const { buildDepGraph } = await import('./dep-graph.js');
    const { buildPythonDepGraph } = await import('./dep-graph-python.js');
    const lang = detectLang(cwd);
    const dep = lang.lang === 'python' ? buildPythonDepGraph(cwd) : buildDepGraph(cwd);
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
