import type { HealthScore } from './health-score.js';
import type { SeoCrawlerReport } from './seo-analyzer.js';
import type { DatabaseReport } from './db-analyzer.js';
import type { PerformanceReport } from './performance-analyzer.js';
import type { LineSizeReport } from './line-size-analyzer.js';

export interface DomainScore {
  name: string;
  score: number;
  detail: string;
}

export interface ProjectInsights {
  scoreReasons: string[];
  domainScores: DomainScore[];
  scoreActions: DomainScore[];
  linkedinSummary: string;
  database: DatabaseReport;
  performance: PerformanceReport;
  lineSize: LineSizeReport;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildProjectInsights(input: {
  projectName: string;
  health: HealthScore;
  seo: SeoCrawlerReport;
  database: DatabaseReport;
  performance: PerformanceReport;
  lineSize: LineSizeReport;
  files: number;
  hotspots: number;
}): ProjectInsights {
  const weakHealth = input.health.dimensions
    .filter((dimension) => dimension.score < 70)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((dimension) => `${dimension.name} lowered the score: ${dimension.score}/100 (${dimension.detail})`);
  const scoreReasons = [
    ...weakHealth,
    input.seo.score < 70 ? `SEO/crawler readiness is ${input.seo.score}/100.` : '',
    input.database.score < 70 ? `Database readiness is ${input.database.score}/100.` : '',
    input.performance.score < 70 ? `Performance readiness is ${input.performance.score}/100.` : '',
  ].filter(Boolean);
  const domainScores: DomainScore[] = [
    ...input.health.dimensions.map((dimension) => ({ name: dimension.name, score: dimension.score, detail: dimension.detail })),
    { name: 'SEO & Crawlers', score: input.seo.score, detail: `${input.seo.issues.length} issue(s), AI policy: ${input.seo.aiCrawlerPolicy}` },
    { name: 'Database', score: input.database.score, detail: `${input.database.ormSignals.join(', ') || 'no ORM signal'}, ${input.database.migrationFiles} migration file(s)` },
    { name: 'Performance', score: input.performance.score, detail: `${input.performance.unrateLimitedApis} unrate-limited API(s), ${input.performance.cacheSignals} cache signal(s)` },
    { name: 'File Size', score: input.lineSize.score, detail: `${input.lineSize.oversized.length} source file(s) over ${input.lineSize.limit} lines` },
  ].sort((a, b) => a.score - b.score);
  const scoreActions = domainScores.slice(0, 5).map((score) => ({
    ...score,
    detail: actionFor(score.name, score.detail),
  }));
  const linkedinSummary = [
    `I am building ${input.projectName}: a CLI that audits a codebase locally and with AI when it adds value.`,
    '',
    `Current report: ${input.health.total}/100 (${input.health.grade}) across ${input.files} files, ${input.hotspots} architecture hotspot(s), SEO/crawler checks, database readiness, performance risk, secrets, SBOM, churn, maintainability, and file-size guardrails.`,
    '',
    'The goal is to help developers move faster without losing engineering context: detect risks, explain architecture, avoid generated-file noise, and project future problems before they hit production.',
    '',
    'Tech: TypeScript, Node.js, static analysis, dependency graphs, local RAG, multi-agent AI workflows, HTML reports, crawler policy checks, and zero-token diagnostics.',
  ].join('\n');
  return { scoreReasons, domainScores, scoreActions, linkedinSummary, database: input.database, performance: input.performance, lineSize: input.lineSize };
}

function actionFor(name: string, detail: string): string {
  if (name === 'Security') return `Fix critical/high findings first. ${detail}`;
  if (name === 'Bus Factor') return `Pair-review or document ownership for critical single-author files. ${detail}`;
  if (name === 'Churn Risk') return `Stabilize high-churn files with tests before new features. ${detail}`;
  if (name === 'Maintainability') return `Split complex files/functions and remove repeated branching. ${detail}`;
  if (name === 'Test Coverage') return `Add focused tests around hotspots, public APIs, and DB boundaries. ${detail}`;
  if (name === 'SEO & Crawlers') return `Add robots.txt, sitemap, canonical metadata, analytics, and AI crawler policy. ${detail}`;
  if (name === 'Database') return `Add migration/index ownership and query-level tests. ${detail}`;
  if (name === 'Performance') return `Add cache/rate limits and remove looped query/await patterns. ${detail}`;
  if (name === 'File Size') return `Keep source files under the configured line limit. ${detail}`;
  return detail;
}

export function renderInsightsMarkdown(insights: ProjectInsights): string {
  const lines = ['## Score Explanation'];
  lines.push(...(insights.scoreReasons.length ? insights.scoreReasons.map((reason) => `- ${reason}`) : ['- No major score drivers detected.']));
  lines.push('', '## Domain Scores', '| Domain | Score | Detail |', '|---|---|---|');
  insights.domainScores.forEach((score) => lines.push(`| ${score.name} | ${score.score}/100 | ${score.detail} |`));
  lines.push('', '## Fastest Score Improvements', '| Priority | Current Score | Action |', '|---|---|---|');
  insights.scoreActions.forEach((score) => lines.push(`| ${score.name} | ${score.score}/100 | ${score.detail} |`));
  lines.push('', '## Token Cost Map');
  lines.push('- Zero token: report, health, local audit, secrets, env-audit, SBOM, SEO/crawler heuristics, database/performance heuristics, file-size scan, graph.');
  lines.push('- Uses AI tokens: normal audit, analyze, chat, explain, fix, and any provider-backed synthesis.');
  lines.push('', `## File Size Guardrail: ${insights.lineSize.score}/100`);
  lines.push(`- Limit: ${insights.lineSize.limit} lines`);
  lines.push(`- Checked source files: ${insights.lineSize.checkedFiles}`);
  lines.push(`- Oversized source files: ${insights.lineSize.oversized.length}`);
  insights.lineSize.oversized.slice(0, 10).forEach((entry) => lines.push(`- ${entry.file}: ${entry.lines} lines (+${entry.overBy})`));
  lines.push('', `## Database Readiness: ${insights.database.score}/100`);
  lines.push(`- ORM signals: ${insights.database.ormSignals.join(', ') || 'none'}`);
  lines.push(`- Migrations: ${insights.database.migrationFiles}`);
  lines.push(`- Raw SQL/query files: ${insights.database.rawSqlFiles}`);
  lines.push(`- Index signals: ${insights.database.indexSignals}`);
  lines.push(`- Pagination signals: ${insights.database.paginationSignals}`);
  lines.push(`- Pool signals: ${insights.database.poolSignals}`);
  if (insights.database.issues.length) {
    lines.push('', '| Severity | Area | Issue | Recommendation |', '|---|---|---|---|');
    insights.database.issues.forEach((issue) => lines.push(`| ${issue.severity} | ${issue.area} | ${issue.issue} | ${issue.recommendation} |`));
  }
  lines.push('', `## Performance Readiness: ${insights.performance.score}/100`);
  lines.push(`- Cache signals: ${insights.performance.cacheSignals}`);
  lines.push(`- Async/blocking risk signals: ${insights.performance.asyncRiskSignals}`);
  lines.push(`- Client render signals: ${insights.performance.clientRenderSignals}`);
  lines.push(`- Uncached fetch signals: ${insights.performance.uncachedFetchSignals}`);
  lines.push(`- Unrate-limited APIs: ${insights.performance.unrateLimitedApis}`);
  if (insights.performance.issues.length) {
    lines.push('', '| Severity | Area | Issue | Recommendation |', '|---|---|---|---|');
    insights.performance.issues.forEach((issue) => lines.push(`| ${issue.severity} | ${issue.area} | ${issue.issue} | ${issue.recommendation} |`));
  }
  lines.push('', '## LinkedIn Summary Draft', insights.linkedinSummary);
  return lines.join('\n');
}

export function renderInsightsHtml(insights: ProjectInsights): string {
  const reasons = insights.scoreReasons.length
    ? insights.scoreReasons.map((reason) => `<li>${esc(reason)}</li>`).join('')
    : '<li>No major score drivers detected.</li>';
  const rows = insights.domainScores.map((score) => `<tr><td>${esc(score.name)}</td><td>${score.score}/100</td><td>${esc(score.detail)}</td></tr>`).join('');
  const actionRows = insights.scoreActions.map((score) => `<tr><td>${esc(score.name)}</td><td>${score.score}/100</td><td>${esc(score.detail)}</td></tr>`).join('');
  const sizeRows = insights.lineSize.oversized.slice(0, 20).map((entry) => `<tr><td class="mono">${esc(entry.file)}</td><td>${entry.lines}</td><td>${entry.overBy}</td></tr>`).join('');
  const dbRows = insights.database.issues.map((issue) => `<tr><td>${esc(issue.severity)}</td><td>${esc(issue.area)}</td><td>${esc(issue.issue)}</td><td>${esc(issue.recommendation)}</td></tr>`).join('');
  const perfRows = insights.performance.issues.map((issue) => `<tr><td>${esc(issue.severity)}</td><td>${esc(issue.area)}</td><td>${esc(issue.issue)}</td><td>${esc(issue.recommendation)}</td></tr>`).join('');
  return `<section id="score-explain"><h2>Score Explanation</h2><ul>${reasons}</ul><h3>Fastest Score Improvements</h3><table><tr><th>Priority</th><th>Current Score</th><th>Action</th></tr>${actionRows}</table><h3>Domain Scores</h3><table><tr><th>Domain</th><th>Score</th><th>Detail</th></tr>${rows}</table></section>
<section id="token-map"><h2>Token Cost Map</h2><div class="split"><div class="card"><strong>Zero token</strong><p>report, health, local audit, secrets, env-audit, SBOM, SEO/crawler heuristics, database/performance heuristics, file-size scan, graph.</p></div><div class="card"><strong>Uses AI tokens</strong><p>normal audit, analyze, chat, explain, fix, and provider-backed synthesis.</p></div></div></section>
<section id="file-size"><h2>File Size Guardrail</h2><div class="grid"><div class="card"><strong>${insights.lineSize.score}/100</strong><br>Score</div><div class="card"><strong>${insights.lineSize.limit}</strong><br>Line limit</div><div class="card"><strong>${insights.lineSize.checkedFiles}</strong><br>Source files</div><div class="card"><strong class="${insights.lineSize.oversized.length ? 'warn' : 'ok'}">${insights.lineSize.oversized.length}</strong><br>Oversized</div></div><table><tr><th>File</th><th>Lines</th><th>Over by</th></tr>${sizeRows || '<tr><td colspan="3">No oversized source files detected.</td></tr>'}</table></section>
<section id="database"><h2>Database Readiness</h2><div class="grid"><div class="card"><strong>${insights.database.score}/100</strong><br>DB score</div><div class="card"><strong>${insights.database.migrationFiles}</strong><br>Migrations</div><div class="card"><strong>${insights.database.indexSignals}</strong><br>Index signals</div><div class="card"><strong>${insights.database.paginationSignals}</strong><br>Pagination signals</div></div><table><tr><th>Severity</th><th>Area</th><th>Issue</th><th>Recommendation</th></tr>${dbRows || '<tr><td colspan="4">No database readiness issues detected.</td></tr>'}</table></section>
<section id="performance"><h2>Performance Readiness</h2><div class="grid"><div class="card"><strong>${insights.performance.score}/100</strong><br>Perf score</div><div class="card"><strong>${insights.performance.cacheSignals}</strong><br>Cache signals</div><div class="card"><strong>${insights.performance.uncachedFetchSignals}</strong><br>Uncached fetches</div><div class="card"><strong>${insights.performance.bundleRisk}</strong><br>Bundle risk</div></div><table><tr><th>Severity</th><th>Area</th><th>Issue</th><th>Recommendation</th></tr>${perfRows || '<tr><td colspan="4">No performance readiness issues detected.</td></tr>'}</table></section>`;
}
