import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildApiMap, auditEnvVars, measureCognitiveLoad, scanCurrentSecrets } from './code-metrics.js';
import { buildSbom } from './sbom.js';
import { buildChurnReport } from './git-analysis.js';
import { detectPatterns } from './pattern-detect.js';
import { computeHealthScore } from './health-score.js';
import { GraphAgent } from '../agents/graph-agent.js';
import type { AuditFinding, AuditReport } from '../schemas/audit.js';
import { displayProjectName } from './project-name.js';
import { analyzeSeoAndCrawlers, type SeoCrawlerReport } from './seo-analyzer.js';
import { projectReportPath } from './project-audit-dashboard.js';
import { analyzeDatabase } from './db-analyzer.js';
import { analyzePerformance } from './performance-analyzer.js';
import { buildProjectInsights, renderInsightsHtml, renderInsightsMarkdown } from './project-insights.js';
import { analyzeLineSize } from './line-size-analyzer.js';
import { buildProjectTrend, renderTrendHtml, renderTrendMarkdown, saveProjectTrend } from './project-trend.js';
import { projectReportCss } from './project-report-style.js';
import type { RepoIndex } from './repo-index.js';

export { projectReportPath, rebuildProjectHtml, saveDomainSnapshot } from './project-audit-dashboard.js';

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
  onProgress?.('analyzing database readiness');
  const database = analyzeDatabase(cwd);
  onProgress?.('analyzing performance readiness');
  const performance = analyzePerformance(cwd, apiEndpoints);
  onProgress?.('checking file size guardrails');
  const lineSize = analyzeLineSize(cwd);
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
  const insights = buildProjectInsights({
    projectName,
    health,
    seo,
    database,
    performance,
    lineSize,
    files: index.stats.files,
    hotspots: hotspots.length,
  });
  const generatedAt = new Date().toLocaleString();
  const trend = buildProjectTrend({ cwd, generatedAt, health, auditCriticals: audit?.criticalCount ?? 0, auditHighs: audit?.highCount ?? 0, seo, database, performance, lineSize });
  onProgress?.('generating HTML report');
  return { projectName, health, audit, churn, patterns, cognitive, generatedAt, trend,
    totalFiles: index.stats.files, totalSymbols: index.stats.symbols, cycles, hotspots, architecture, apiEndpoints, envAudit, secrets, sbom, seo, database, performance, improvementPerspectives, insights };
}

export function renderProjectMarkdown(data: Awaited<ReturnType<typeof buildProjectReportData>>): string {
  const lines: string[] = [];
  lines.push(`# ${data.projectName} - AI Analysis Context`);
  lines.push(`> Generated: ${data.generatedAt}. Use this compact project report for architecture and improvement analysis.`);
  lines.push('', `## Health Score: ${data.health.total}/100 (${data.health.grade})`, '');
  lines.push('| Dimension | Score | Detail |', '|---|---|---|');
  data.health.dimensions.forEach((d) => lines.push(`| ${d.name} | ${d.score}/100 | ${d.detail} |`));
  lines.push('', renderTrendMarkdown(data.trend), '');
  lines.push('', renderInsightsMarkdown(data.insights), '');
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.projectName)} - Project Report</title><style>${projectReportCss(gradeColor)}</style></head><body><nav><a href="#health">Health</a><a href="#trend">Changes</a><a href="#score-explain">Score</a><a href="#token-map">Tokens</a><a href="#architecture">Architecture</a><a href="#seo">SEO & Crawlers</a><a href="#database">Database</a><a href="#performance">Performance</a><a href="#diagnostics">Diagnostics</a><a href="#audit">Audit</a><a href="#improvements">10 Personas</a><a href="#churn">Churn</a><a href="#complexity">Complexity</a>${graphExists ? '<a href="../graph.html">Interactive Graph</a>' : ''}</nav><main class="container">
<section class="header"><div><h1>${esc(data.projectName)}</h1><p>Generated ${esc(data.generatedAt)} · ${data.audit ? `${data.audit.totalFiles} files audited` : 'no audit data'}</p></div><div class="score" title="Health Score"><strong>${data.health.total}/100</strong><span>Grade ${data.health.grade}</span></div></section>
<section id="health"><h2>Health</h2>${dimBars}${riskRows ? `<h3>Top Risks</h3><ul>${riskRows}</ul>` : ''}</section>
${renderTrendHtml(data.trend)}
${renderInsightsHtml(data.insights)}
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
  writeFileSync(join(outDir, 'linkedin-summary.md'), data.insights.linkedinSummary, 'utf8');
  saveProjectTrend(cwd, data.trend.current);
  if (mdOnly) return { mdFile, md };
  const html = renderProjectHtml(data, existsSync(join(outDir, 'graph.html')));
  const htmlFile = projectReportPath(cwd);
  writeFileSync(htmlFile, html, 'utf8');
  writeFileSync(join(outDir, 'report.html'), html, 'utf8');
  return { mdFile, htmlFile, md };
}
