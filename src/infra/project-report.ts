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
import { displayProjectName } from './project-name.js';
import { analyzeSeoAndCrawlers, type SeoCrawlerReport } from './seo-analyzer.js';
import type { RepoIndex } from './repo-index.js';

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

interface ArchitectureNode {
  id: string;
  files: number;
  loc: number;
  symbols: number;
  fanIn: number;
  fanOut: number;
}

interface ArchitectureEdge {
  from: string;
  to: string;
  weight: number;
}

interface ImprovementPerspective {
  persona: string;
  focus: string;
  risk: string;
  recommendation: string;
  projection: string;
}

function moduleName(path: string): string {
  const parts = path.split('/');
  if (parts[0] === 'src' && parts[1]) return `src/${parts[1]}`;
  return parts[0] ?? 'root';
}

function buildArchitectureView(index: RepoIndex, cycles: number, lang: string) {
  const nodes = new Map<string, ArchitectureNode>();
  const edgeCounts = new Map<string, ArchitectureEdge>();

  for (const file of index.files) {
    const id = moduleName(file.path);
    const node = nodes.get(id) ?? { id, files: 0, loc: 0, symbols: 0, fanIn: 0, fanOut: 0 };
    node.files++;
    node.loc += file.loc;
    nodes.set(id, node);
  }

  for (const symbol of index.symbols) {
    const node = nodes.get(moduleName(symbol.file));
    if (node) node.symbols++;
  }

  for (const imp of index.imports) {
    if (!imp.resolved) continue;
    const from = moduleName(imp.from);
    const to = moduleName(imp.resolved);
    if (from === to) continue;
    const key = `${from} -> ${to}`;
    const edge = edgeCounts.get(key) ?? { from, to, weight: 0 };
    edge.weight++;
    edgeCounts.set(key, edge);
    const fromNode = nodes.get(from);
    const toNode = nodes.get(to);
    if (fromNode) fromNode.fanOut++;
    if (toNode) toNode.fanIn++;
  }

  const topNodes = [...nodes.values()]
    .sort((a, b) => (b.fanIn + b.fanOut + b.files) - (a.fanIn + a.fanOut + a.files) || a.id.localeCompare(b.id))
    .slice(0, 12);
  const kept = new Set(topNodes.map((node) => node.id));
  const edges = [...edgeCounts.values()]
    .filter((edge) => kept.has(edge.from) && kept.has(edge.to))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 24);

  const style = cycles > 0 ? 'Cyclic / coupled' : edges.length > topNodes.length * 1.5 ? 'Layered with cross-module coupling' : 'Modular / low-cycle';
  return { lang, style, nodes: topNodes, edges };
}

function renderArchitectureSvg(nodes: ArchitectureNode[], edges: ArchitectureEdge[]): string {
  if (nodes.length === 0) return '<p class="muted">No architecture graph data available.</p>';
  const width = 1040;
  const height = Math.max(360, Math.ceil(nodes.length / 4) * 130 + 80);
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    positions.set(node.id, { x: 140 + col * 250, y: 90 + row * 130 });
  });
  const edgeSvg = edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return '';
    const stroke = Math.min(5, 1 + edge.weight / 2);
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#30363d" stroke-width="${stroke}" marker-end="url(#arrow)"><title>${esc(edge.from)} -> ${esc(edge.to)} (${edge.weight})</title></line>`;
  }).join('');
  const nodeSvg = nodes.map((node) => {
    const pos = positions.get(node.id)!;
    const r = Math.max(34, Math.min(58, 28 + Math.sqrt(node.files + node.symbols)));
    const hot = node.fanIn + node.fanOut >= 10;
    return `<g transform="translate(${pos.x},${pos.y})">
  <circle r="${r}" fill="${hot ? '#3d2f00' : '#161b22'}" stroke="${hot ? '#e3b341' : '#58a6ff'}" stroke-width="2"></circle>
  <text text-anchor="middle" y="-6" fill="#e6edf3" font-size="12" font-weight="700">${esc(node.id)}</text>
  <text text-anchor="middle" y="14" fill="#8b949e" font-size="11">${node.files} files · ${node.symbols} sym</text>
  <text text-anchor="middle" y="31" fill="#8b949e" font-size="10">in ${node.fanIn} / out ${node.fanOut}</text>
</g>`;
  }).join('');
  return `<div class="graph-wrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Application module graph">
<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#30363d"/></marker></defs>
${edgeSvg}${nodeSvg}
</svg></div>`;
}

function buildImprovementPerspectives(input: {
  healthTotal: number;
  cycles: number;
  hotspots: number;
  totalFiles: number;
  cognitiveAvg: number;
  apiEndpoints: number;
  unauthenticatedApis: number;
  unrateLimitedApis: number;
  seo: SeoCrawlerReport;
  audit?: AuditReport | null;
  unpinnedDeps: number;
}): ImprovementPerspective[] {
  const growth = input.totalFiles > 120 ? 'as the codebase grows' : 'when the project starts scaling';
  return [
    {
      persona: 'SEO Engineer',
      focus: 'Google discoverability and public metadata',
      risk: input.seo.score < 70 ? 'Search engines may index incomplete or duplicated content.' : 'SEO baseline is acceptable, but should be monitored per release.',
      recommendation: 'Keep robots.txt, sitemap.xml, canonical tags, title, description, OpenGraph, and JSON-LD in the report checklist.',
      projection: input.seo.score < 70 ? 'Future landing pages can ship without crawlability and lose organic traffic.' : 'Future pages can be validated automatically before release.',
    },
    {
      persona: 'AI Crawler Policy Lead',
      focus: 'GPTBot, ClaudeBot, PerplexityBot, CCBot, and Google-Extended policy',
      risk: input.seo.aiCrawlerPolicy === 'missing' ? 'AI crawlers have no explicit allow/block guidance.' : 'AI crawler policy exists but should track product/legal decisions.',
      recommendation: 'Document crawler policy in robots.txt and keep it aligned with content licensing and product strategy.',
      projection: 'Without explicit policy, future content may be used or blocked inconsistently by AI search and answer engines.',
    },
    {
      persona: 'Analytics Engineer',
      focus: 'Google Analytics, Tag Manager, and Search Console instrumentation',
      risk: input.seo.googleAnalytics || input.seo.googleTagManager ? 'Analytics exists; conversion events still need validation.' : 'Production traffic may be invisible after launch.',
      recommendation: 'Add GA4/GTM, Search Console verification, conversion events, and crawler/organic dashboards.',
      projection: 'Future release impact will be hard to measure without baseline traffic and event data.',
    },
    {
      persona: 'Performance Engineer',
      focus: 'Rendering, bundle size, API latency, and crawler-friendly pages',
      risk: input.apiEndpoints > 0 && input.unrateLimitedApis > 0 ? `${input.unrateLimitedApis} API endpoint(s) show no rate-limit signal.` : 'Performance risk is mostly architectural and should be tracked with synthetic checks.',
      recommendation: 'Add route-level latency budgets, cache strategy, rate limits, and SSR/SSG checks for public pages.',
      projection: `${growth}, unbounded APIs and client-only rendering can increase latency and reduce crawler extraction quality.`,
    },
    {
      persona: 'Database Architect',
      focus: 'Data model, query growth, indexes, and API-to-DB pressure',
      risk: input.apiEndpoints > 0 ? 'API growth can create hidden N+1 queries, missing indexes, and transactional coupling.' : 'Database risk is unknown because no API surface was detected.',
      recommendation: 'Map each API/domain module to tables, expected cardinality, indexes, read/write paths, and slow-query budgets.',
      projection: 'At higher traffic, missing indexes and unclear ownership boundaries usually become latency spikes and migration risk.',
    },
    {
      persona: 'Software Architect',
      focus: 'Coupling, module boundaries, and graph health',
      risk: input.cycles > 0 ? `${input.cycles} dependency cycle(s) can block refactors.` : `${input.hotspots} hotspot module(s) should be watched.`,
      recommendation: 'Use the architecture graph to define module boundaries and reduce hotspot fan-in/fan-out before adding major features.',
      projection: 'If central modules keep absorbing responsibilities, future changes will require broader regression testing.',
    },
    {
      persona: 'Security Engineer',
      focus: 'Authentication, authorization, supply chain, and exposed metadata',
      risk: input.audit?.criticalCount || input.audit?.highCount ? `${input.audit.criticalCount} critical and ${input.audit.highCount} high audit finding(s) remain.` : 'No high-severity audit signal in the latest report.',
      recommendation: 'Keep local secrets/SBOM scans zero-token and run focused AI audits only for high-risk domains.',
      projection: 'Unpinned dependencies and unauthenticated endpoints become higher-impact as deployment surface grows.',
    },
    {
      persona: 'SRE',
      focus: 'Observability, reliability, and future incident detection',
      risk: input.healthTotal < 70 ? `Health score ${input.healthTotal}/100 indicates operational fragility.` : 'Health score is acceptable, but trend data should be monitored.',
      recommendation: 'Add health trend gates, error budgets, logs/traces coverage, and release dashboards.',
      projection: 'Without trend history, regressions in churn, bus factor, and maintainability will appear late.',
    },
    {
      persona: 'QA Lead',
      focus: 'Coverage, regression risk, and generated-file noise',
      risk: input.cognitiveAvg > 25 ? `Average cognitive score ${input.cognitiveAvg} suggests harder test design.` : 'Complexity is manageable but should be tracked per hotspot.',
      recommendation: 'Prioritize tests around hotspots, high-churn files, and public API/database boundaries.',
      projection: 'As complexity grows, low coverage around central modules will turn small changes into broad regressions.',
    },
    {
      persona: 'Developer Experience Lead',
      focus: 'Actionability, onboarding, and report signal quality',
      risk: input.unpinnedDeps > 0 ? `${input.unpinnedDeps} unpinned dependency signal(s) can distract or create supply-chain drift.` : 'Report noise is lower after excluding generated artifacts.',
      recommendation: 'Keep generated/build artifacts excluded, add suppressions for accepted risks, and make each report section actionable.',
      projection: 'Cleaner reports reduce triage time and make the tool easier for other devs to adopt in daily workflows.',
    },
  ];
}

// ── Original report functions ─────────────────────────────────────────────────

export function latestAuditPointer(cwd: string): { runDir?: string; html?: string; digest?: string; aiContext?: string; report?: string; createdAt?: string } | null {
  try {
    const reportsDir = join(cwd, '.ai-runtime', 'reports');
    const pointerPath = join(reportsDir, 'latest-audit.json');
    const pointer = existsSync(pointerPath)
      ? JSON.parse(readFileSync(pointerPath, 'utf8')) as { runDir?: string; html?: string; digest?: string; aiContext?: string; report?: string; createdAt?: string }
      : null;
    const historyPath = join(reportsDir, 'audit-history.json');
    if (!existsSync(historyPath)) return pointer;

    const history = JSON.parse(readFileSync(historyPath, 'utf8')) as Array<{ createdAt: string; runRelDir: string }>;
    const last = history
      .filter((entry) => entry.createdAt && entry.runRelDir)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (!last) return pointer;
    if (pointer?.createdAt && new Date(pointer.createdAt).getTime() >= new Date(last.createdAt).getTime()) return pointer;

    const runDir = join(reportsDir, last.runRelDir);
    return {
      runDir,
      html: join(runDir, 'index.html'),
      summary: join(runDir, 'summary.md'),
      digest: join(runDir, 'digest.md'),
      aiContext: join(runDir, 'ai-context.md'),
      actionPlan: join(runDir, 'action-plan.md'),
      report: join(runDir, 'report.json'),
      createdAt: last.createdAt,
    } as { runDir?: string; html?: string; digest?: string; aiContext?: string; report?: string; createdAt?: string };
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

export async function buildProjectReportData(cwd: string, days: number, onProgress?: (message: string) => void) {
  const projectName = displayProjectName(cwd);
  onProgress?.('indexing files and symbols');
  const graph = new GraphAgent(cwd);
  const index = await graph.ensureIndex();
  let hotspots: Array<{ file: string; fanIn: number; fanOut: number }> = [];
  let cycles = 0;
  let detectedLang = 'unknown';
  onProgress?.('calculating dependencies and hotspots');
  try {
    const { detectLang } = await import('./lang-detect.js');
    const { buildDepGraphAuto } = await import('./dep-graph.js');
    const lang = detectLang(cwd);
    detectedLang = lang.lang;
    const dep = buildDepGraphAuto(cwd, lang.lang);
    hotspots = dep.hotspots;
    cycles = dep.cycles.length;
  } catch { /* best-effort */ }
  onProgress?.('loading latest audit');
  const audit = loadLatestAudit(cwd);
  onProgress?.('analyzing churn and bus factor');
  const churn = buildChurnReport(cwd, hotspots.map((h) => h.file), days);
  onProgress?.('detecting patterns and complexity');
  const patterns = detectPatterns(cwd, hotspots);
  const cognitive = measureCognitiveLoad(cwd, 30);
  onProgress?.('running zero-token local scanners');
  const apiEndpoints = buildApiMap(cwd);
  const envAudit = auditEnvVars(cwd);
  const secrets = scanCurrentSecrets(cwd);
  const sbom = buildSbom(cwd);
  onProgress?.('checking SEO, analytics, and crawler policy');
  const seo = analyzeSeoAndCrawlers(cwd);
  const architecture = buildArchitectureView(index, cycles, detectedLang);
  onProgress?.('calculating health score');
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
  const cognitiveAvg = cognitive.length ? Math.round(cognitive.slice(0, 10).reduce((sum, entry) => sum + entry.score, 0) / Math.min(cognitive.length, 10)) : 0;
  const improvementPerspectives = buildImprovementPerspectives({
    healthTotal: health.total,
    cycles,
    hotspots: hotspots.length,
    totalFiles: index.stats.files,
    cognitiveAvg,
    apiEndpoints: apiEndpoints.length,
    unauthenticatedApis: apiEndpoints.filter((endpoint) => !endpoint.hasAuth).length,
    unrateLimitedApis: apiEndpoints.filter((endpoint) => !endpoint.hasRateLimit).length,
    seo,
    audit,
    unpinnedDeps: sbom.unpinned.length,
  });
  onProgress?.('generating HTML report');
  return { projectName, health, audit, churn, patterns, cognitive, generatedAt: new Date().toLocaleString(),
    totalFiles: index.stats.files, totalSymbols: index.stats.symbols, cycles, hotspots, architecture, apiEndpoints, envAudit, secrets, sbom, seo, improvementPerspectives };
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
  lines.push('## Architecture');
  lines.push(`- Primary language: ${data.architecture.lang}`);
  lines.push(`- Shape: ${data.architecture.style}`);
  lines.push(`- Modules: ${data.architecture.nodes.length}`);
  lines.push('', `## SEO, Analytics & Crawlers: ${data.seo.score}/100`);
  lines.push(`- robots.txt: ${data.seo.robotsTxt ? 'present' : 'missing'}`);
  lines.push(`- sitemap: ${data.seo.sitemap ? 'present' : 'missing'}`);
  lines.push(`- AI crawler policy: ${data.seo.aiCrawlerPolicy}`);
  lines.push(`- Google Analytics/GTM: ${data.seo.googleAnalytics || data.seo.googleTagManager ? 'detected' : 'not detected'}`);
  lines.push(`- Search Console: ${data.seo.searchConsole ? 'detected' : 'not detected'}`);
  if (data.seo.issues.length > 0) {
    lines.push('', '| Severity | Area | Issue | Recommendation |', '|---|---|---|---|');
    data.seo.issues.slice(0, 10).forEach((issue) => lines.push(`| ${issue.severity} | ${issue.area} | ${issue.issue} | ${issue.recommendation} |`));
  }
  lines.push('', '## Improvement Perspectives');
  lines.push('| Persona | Focus | Risk | Recommendation | Projection |', '|---|---|---|---|---|');
  data.improvementPerspectives.forEach((p) => lines.push(`| ${p.persona} | ${p.focus} | ${p.risk} | ${p.recommendation} | ${p.projection} |`));
  if (data.patterns.detected.length > 0) {
    lines.push('- Detected patterns: ' + data.patterns.detected.slice(0, 8).map((p) => p.pattern).join(', '));
  }
  lines.push('');
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
  const riskRows = data.health.topRisks.map((r) => `<li>${esc(r)}</li>`).join('');
  const architectureRows = data.architecture.nodes.map((node) => `<tr><td class="mono">${esc(node.id)}</td><td>${node.files}</td><td>${node.symbols}</td><td>${node.loc}</td><td>${node.fanIn}</td><td>${node.fanOut}</td></tr>`).join('');
  const patternRows = data.patterns.detected.slice(0, 12).map((pattern) => `<tr><td>${esc(pattern.pattern)}</td><td>${esc(pattern.category)}</td><td>${esc(pattern.confidence)}</td><td>${pattern.evidence.map(esc).join('<br>')}</td></tr>`).join('');
  const antiPatternRows = data.patterns.antiPatterns.slice(0, 12).map((pattern) => `<tr><td>${esc(pattern.name)}</td><td>${esc(pattern.severity)}</td><td>${esc(pattern.description)}</td><td>${pattern.evidence.map(esc).join('<br>')}</td></tr>`).join('');
  const seoSignalRows = data.seo.signals.map((signal) => `<tr><td>${esc(signal.name)}</td><td><span class="${signal.status === 'ok' ? 'ok' : signal.status === 'warn' ? 'warn' : 'sev-high'}">${esc(signal.status)}</span></td><td>${esc(signal.detail)}</td></tr>`).join('');
  const seoIssueRows = data.seo.issues.map((issue) => `<tr><td>${esc(issue.severity)}</td><td>${esc(issue.area)}</td><td>${esc(issue.issue)}</td><td>${esc(issue.recommendation)}</td></tr>`).join('');
  const perspectiveRows = data.improvementPerspectives.map((p) => `<tr><td>${esc(p.persona)}</td><td>${esc(p.focus)}</td><td>${esc(p.risk)}</td><td>${esc(p.recommendation)}</td><td>${esc(p.projection)}</td></tr>`).join('');
  const secretRows = data.secrets.length
    ? data.secrets.map((s) => `<tr><td class="mono">${esc(s.file)}:${s.line}</td><td>${esc(s.pattern)}</td><td class="mono">${esc(s.preview)}</td></tr>`).join('')
    : '<tr><td colspan="3">No hardcoded secrets detected.</td></tr>';
  const envRows = data.envAudit.vars.slice(0, 50).map((v) => `<tr><td>${v.documented ? 'yes' : 'no'}</td><td class="mono">${esc(v.name)}</td><td class="mono">${esc(v.file)}:${v.line}</td></tr>`).join('');
  const sbomRows = data.sbom.unpinned.slice(0, 50).map((p) => `<tr><td>${esc(p.lang)}</td><td class="mono">${esc(p.name)}</td><td>${esc(p.version)}</td></tr>`).join('');
  const apiRows = data.apiEndpoints.slice(0, 50).map((ep) => `<tr><td>${esc(ep.method)}</td><td class="mono">${esc(ep.path)}</td><td>${ep.hasAuth ? 'yes' : 'no'}</td><td>${ep.hasRateLimit ? 'yes' : 'no'}</td><td class="mono">${esc(ep.file)}:${ep.line}</td></tr>`).join('');
  const architectureSvg = renderArchitectureSvg(data.architecture.nodes, data.architecture.edges);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.projectName)} - Project Report</title><style>
body{background:#0d1117;color:#e6edf3;font:14px/1.55 system-ui,sans-serif;margin:0}nav{position:sticky;top:0;background:#161b22;border-bottom:1px solid #30363d;padding:12px 24px;display:flex;gap:18px;flex-wrap:wrap;z-index:2}a{color:#79c0ff;text-decoration:none}.container{max-width:1200px;margin:auto;padding:24px}.header{border:1px solid #30363d;background:#161b22;border-radius:8px;padding:22px;display:flex;justify-content:space-between}.score{color:${gradeColor};text-align:right}.score strong{display:block;font-size:48px;line-height:1;font-weight:800}.score span{display:block;margin-top:6px;color:#8b949e;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}h2{color:#79c0ff;border-bottom:1px solid #30363d;padding-bottom:8px;margin-top:34px}.dim-row{display:grid;grid-template-columns:140px 1fr 40px 1fr;gap:12px;margin:7px 0}.bar{background:#21262d;height:8px;border-radius:4px}.bar div{height:8px;border-radius:4px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px}.card strong{font-size:24px}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #21262d;padding:8px;text-align:left;vertical-align:top}.muted{color:#8b949e}.warn{color:#e3b341}.ok{color:#3fb950}.sev-high{color:#f85149}.graph-wrap{background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:auto;margin:14px 0}.graph-wrap svg{display:block;min-width:900px;width:100%;height:auto}.split{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:800px){.grid,.dim-row,.split{grid-template-columns:1fr}.header{display:block}.score{text-align:left;margin-top:16px}}
</style></head><body><nav><a href="#health">Health</a><a href="#architecture">Architecture</a><a href="#seo">SEO & Crawlers</a><a href="#diagnostics">Diagnostics</a><a href="#audit">Audit</a><a href="#improvements">10 Personas</a><a href="#churn">Churn</a><a href="#complexity">Complexity</a>${graphExists ? '<a href="../graph.html">Interactive Graph</a>' : ''}</nav><main class="container">
<section class="header"><div><h1>${esc(data.projectName)}</h1><p>Generated ${esc(data.generatedAt)} · ${data.audit ? `${data.audit.totalFiles} files audited` : 'no audit data'}</p></div><div class="score" title="Health Score"><strong>${data.health.total}/100</strong><span>Grade ${data.health.grade}</span></div></section>
<section id="health"><h2>Health</h2>${dimBars}${riskRows ? `<h3>Top Risks</h3><ul>${riskRows}</ul>` : ''}</section>
<section id="architecture"><h2>Architecture</h2><div class="grid"><div class="card"><strong>${esc(data.architecture.lang)}</strong><br>Primary language</div><div class="card"><strong>${data.architecture.nodes.length}</strong><br>Top modules</div><div class="card"><strong class="${data.cycles ? 'warn' : 'ok'}">${data.cycles}</strong><br>Dependency cycles</div><div class="card"><strong>${data.hotspots.length}</strong><br>Hotspots</div></div>
<p class="muted">Shape: ${esc(data.architecture.style)}${graphExists ? ' · Interactive dependency graph available in the top nav.' : ''}</p>
${architectureSvg}
<div class="split"><div><h3>Detected Architecture Patterns</h3><table><tr><th>Pattern</th><th>Category</th><th>Confidence</th><th>Evidence</th></tr>${patternRows || '<tr><td colspan="4">No explicit architecture patterns detected.</td></tr>'}</table></div>
<div><h3>Architecture Risks</h3><table><tr><th>Name</th><th>Severity</th><th>Description</th><th>Evidence</th></tr>${antiPatternRows || '<tr><td colspan="4">No architecture anti-patterns detected.</td></tr>'}</table></div></div>
<h3>Module Coupling</h3><table><tr><th>Module</th><th>Files</th><th>Symbols</th><th>LOC</th><th>Fan-in</th><th>Fan-out</th></tr>${architectureRows || '<tr><td colspan="6">No module data available.</td></tr>'}</table></section>
<section id="seo"><h2>SEO, Analytics & AI Crawlers</h2><div class="grid"><div class="card"><strong class="${data.seo.score >= 80 ? 'ok' : data.seo.score >= 60 ? 'warn' : 'sev-high'}">${data.seo.score}/100</strong><br>SEO score</div><div class="card"><strong class="${data.seo.robotsTxt ? 'ok' : 'sev-high'}">${data.seo.robotsTxt ? 'yes' : 'no'}</strong><br>robots.txt</div><div class="card"><strong class="${data.seo.sitemap ? 'ok' : 'sev-high'}">${data.seo.sitemap ? 'yes' : 'no'}</strong><br>sitemap</div><div class="card"><strong>${esc(data.seo.aiCrawlerPolicy)}</strong><br>AI crawler policy</div></div>
<h3>Crawler & Analytics Signals</h3><table><tr><th>Signal</th><th>Status</th><th>Detail</th></tr>${seoSignalRows}</table>
<h3>SEO Issues</h3><table><tr><th>Severity</th><th>Area</th><th>Issue</th><th>Recommendation</th></tr>${seoIssueRows || '<tr><td colspan="4">No SEO/crawler issues detected.</td></tr>'}</table></section>
<section id="diagnostics"><h2>Local Diagnostics <span class="muted">(zero token)</span></h2><div class="grid"><div class="card"><strong class="${data.secrets.length ? 'warn' : 'ok'}">${data.secrets.length}</strong><br>Secrets</div><div class="card"><strong>${data.envAudit.vars.length}</strong><br>Env vars</div><div class="card"><strong class="${data.sbom.unpinned.length ? 'warn' : 'ok'}">${data.sbom.unpinned.length}</strong><br>Unpinned deps</div><div class="card"><strong>${data.apiEndpoints.length}</strong><br>API endpoints</div></div>
<h3>Secrets</h3><table><tr><th>Location</th><th>Pattern</th><th>Preview</th></tr>${secretRows}</table>
<h3>Environment Variables</h3><table><tr><th>Documented</th><th>Name</th><th>Location</th></tr>${envRows || '<tr><td colspan="3">No environment variables detected.</td></tr>'}</table>
<h3>Unpinned Dependencies</h3><table><tr><th>Lang</th><th>Name</th><th>Version</th></tr>${sbomRows || '<tr><td colspan="3">No unpinned dependencies detected.</td></tr>'}</table>
${apiRows ? `<h3>API Map</h3><table><tr><th>Method</th><th>Path</th><th>Auth</th><th>Rate limit</th><th>Location</th></tr>${apiRows}</table>` : ''}
</section>
${data.audit ? `<section id="audit"><h2>Audit</h2><div class="grid"><div class="card"><strong>${data.audit.findings.length}</strong><br>Findings</div><div class="card"><strong>${data.audit.criticalCount}</strong><br>Critical</div><div class="card"><strong>${data.audit.highCount}</strong><br>High</div></div><p>${esc(data.audit.summary)}</p><table><tr><th>Severity</th><th>Location</th><th>Category</th><th>Finding</th></tr>${findingRows}</table></section>` : ''}
<section id="improvements"><h2>Improvement Projections by 10 Personas</h2><table><tr><th>Persona</th><th>Focus</th><th>Risk</th><th>Recommendation</th><th>Future Projection</th></tr>${perspectiveRows}</table></section>
${data.churn.churn.length ? `<section id="churn"><h2>Churn</h2><table><tr><th>File</th><th>Commits</th><th>Authors</th><th>Risk</th></tr>${churnRows}</table></section>` : ''}
${data.cognitive.length ? `<section id="complexity"><h2>Complexity</h2><table><tr><th>File</th><th>Score</th><th>Nesting</th><th>Long Functions</th><th>LOC</th></tr>${cogRows}</table></section>` : ''}
</main></body></html>`;
}

export function writeProjectReport(cwd: string, data: Awaited<ReturnType<typeof buildProjectReportData>>, mdOnly: boolean): { mdFile: string; htmlFile?: string; md: string } {
  const outDir = join(cwd, '.ai-runtime');
  const reportsDir = join(outDir, 'reports');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  const md = renderProjectMarkdown(data);
  const mdFile = join(outDir, 'context.md');
  writeFileSync(mdFile, md, 'utf8');
  if (mdOnly) return { mdFile, md };
  const html = renderProjectHtml(data, existsSync(join(outDir, 'graph.html')));
  const htmlFile = projectReportPath(cwd);
  writeFileSync(htmlFile, html, 'utf8');
  writeFileSync(join(outDir, 'report.html'), html, 'utf8');
  return { mdFile, htmlFile, md };
}

// ── Accumulated project audit report (domain tabs) ────────────────────────────

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
  security: 'Security', bugs: 'Bugs', 'error-handling': 'Error Handling',
  architecture: 'Architecture', testing: 'Tests', performance: 'Performance',
  observability: 'Observability', resilience: 'Resilience', compliance: 'Compliance',
  dependencies: 'Dependencies', infrastructure: 'Infrastructure', data: 'Data',
  multitenancy: 'Multitenancy', redundancy: 'Redundancy', 'prompt-audit': 'Prompt Audit', local: 'Local',
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
  const projectName = displayProjectName(cwd);
  const totalCrit = domains.reduce((s, d) => s + d.findings.filter((f) => f.severity === 'critical').length, 0);
  const totalHigh = domains.reduce((s, d) => s + d.findings.filter((f) => f.severity === 'high').length, 0);
  const totalFindings = domains.reduce((s, d) => s + d.findings.length, 0);
  const dateStr = new Date().toLocaleDateString('en-US');

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
    const agoStr = ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;

    const cards = sorted.length === 0
      ? `<div class="empty" style="padding:48px 24px"><span class="ms material-symbols-outlined" style="font-size:48px;color:#3fb950;font-variation-settings:'FILL' 1">check_circle</span><p style="margin:12px 0 0;font-size:15px">No findings in this domain.</p></div>`
      : sorted.map((f) => {
          const loc = f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : '';
          const copyData = esc(`${f.severity.toUpperCase()}: ${f.finding}${loc ? ' — ' + loc : ''}${f.recommendation ? '\nRecommendation: ' + f.recommendation : ''}`);
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
    <button onclick="copyFinding(this)" data-text="${copyData}" class="copy-btn" title="Copy">
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
<html lang="en">
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
    <span class="ms material-symbols-outlined" style="font-size:18px">content_copy</span>Copy all
  </button>
</header>
<aside class="sidebar">
  <div style="margin-bottom:16px;padding:0 4px">
    <h2 style="margin:0;font-size:15px;font-weight:700;color:#e0e2ea">${esc(projectName)}</h2>
    <p style="margin:4px 0 0;font-size:12px;color:#8b919d;font-family:'JetBrains Mono',monospace">${esc(dateStr)}</p>
  </div>
  <nav class="sidebar-nav">
    ${domains.length === 0 ? '<p style="color:#8b919d;font-size:13px;padding:0 4px">No scans yet.</p>' : sidebarItems}
  </nav>
  <div class="sidebar-footer">
    <span class="sidebar-lbl">Feedback &amp; Contact</span>
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
      <h1>Audit Report</h1>
      <p>
        <span class="ms material-symbols-outlined" style="font-size:16px">domain</span>
        ${domains.length} scanned domain${domains.length !== 1 ? 's' : ''}
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
    ? `<div class="empty"><span class="ms material-symbols-outlined" style="font-size:64px">search_off</span><p style="margin:12px 0 0;font-size:18px;font-weight:600;color:#e0e2ea">No scans yet.</p><p style="margin:8px 0 0;font-size:14px">Run <code style="background:#272a30;padding:2px 8px;border-radius:4px">aion</code> and choose a category.</p></div>`
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
