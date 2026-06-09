import type { HealthScore } from './health-score.js';
import type { SeoCrawlerReport } from './seo-analyzer.js';
import type { DatabaseReport } from './db-analyzer.js';
import type { PerformanceReport } from './performance-analyzer.js';

export interface DomainScore {
  name: string;
  score: number;
  detail: string;
}

export interface ProjectInsights {
  scoreReasons: string[];
  domainScores: DomainScore[];
  linkedinSummary: string;
  database: DatabaseReport;
  performance: PerformanceReport;
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
  ].sort((a, b) => a.score - b.score);
  const linkedinSummary = [
    `I am building ${input.projectName}: a CLI that audits a codebase locally and with AI when it adds value.`,
    '',
    `Current report: ${input.health.total}/100 (${input.health.grade}) across ${input.files} files, ${input.hotspots} architecture hotspot(s), SEO/crawler checks, database readiness, performance risk, secrets, SBOM, churn, and maintainability.`,
    '',
    'The goal is to help developers move faster without losing engineering context: detect risks, explain architecture, avoid generated-file noise, and project future problems before they hit production.',
    '',
    'Tech: TypeScript, Node.js, static analysis, dependency graphs, local RAG, multi-agent AI workflows, HTML reports, crawler policy checks, and zero-token diagnostics.',
  ].join('\n');
  return { scoreReasons, domainScores, linkedinSummary, database: input.database, performance: input.performance };
}

export function renderInsightsMarkdown(insights: ProjectInsights): string {
  const lines = ['## Score Explanation'];
  lines.push(...(insights.scoreReasons.length ? insights.scoreReasons.map((reason) => `- ${reason}`) : ['- No major score drivers detected.']));
  lines.push('', '## Domain Scores', '| Domain | Score | Detail |', '|---|---|---|');
  insights.domainScores.forEach((score) => lines.push(`| ${score.name} | ${score.score}/100 | ${score.detail} |`));
  lines.push('', `## Database Readiness: ${insights.database.score}/100`);
  lines.push(`- ORM signals: ${insights.database.ormSignals.join(', ') || 'none'}`);
  lines.push(`- Migrations: ${insights.database.migrationFiles}`);
  lines.push(`- Raw SQL/query files: ${insights.database.rawSqlFiles}`);
  lines.push(`- Index signals: ${insights.database.indexSignals}`);
  if (insights.database.issues.length) {
    lines.push('', '| Severity | Area | Issue | Recommendation |', '|---|---|---|---|');
    insights.database.issues.forEach((issue) => lines.push(`| ${issue.severity} | ${issue.area} | ${issue.issue} | ${issue.recommendation} |`));
  }
  lines.push('', `## Performance Readiness: ${insights.performance.score}/100`);
  lines.push(`- Cache signals: ${insights.performance.cacheSignals}`);
  lines.push(`- Async/blocking risk signals: ${insights.performance.asyncRiskSignals}`);
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
  const dbRows = insights.database.issues.map((issue) => `<tr><td>${esc(issue.severity)}</td><td>${esc(issue.area)}</td><td>${esc(issue.issue)}</td><td>${esc(issue.recommendation)}</td></tr>`).join('');
  const perfRows = insights.performance.issues.map((issue) => `<tr><td>${esc(issue.severity)}</td><td>${esc(issue.area)}</td><td>${esc(issue.issue)}</td><td>${esc(issue.recommendation)}</td></tr>`).join('');
  return `<section id="score-explain"><h2>Score Explanation</h2><ul>${reasons}</ul><h3>Domain Scores</h3><table><tr><th>Domain</th><th>Score</th><th>Detail</th></tr>${rows}</table></section>
<section id="database"><h2>Database Readiness</h2><div class="grid"><div class="card"><strong>${insights.database.score}/100</strong><br>DB score</div><div class="card"><strong>${insights.database.migrationFiles}</strong><br>Migrations</div><div class="card"><strong>${insights.database.indexSignals}</strong><br>Index signals</div><div class="card"><strong>${insights.database.rawSqlFiles}</strong><br>Raw SQL/query files</div></div><table><tr><th>Severity</th><th>Area</th><th>Issue</th><th>Recommendation</th></tr>${dbRows || '<tr><td colspan="4">No database readiness issues detected.</td></tr>'}</table></section>
<section id="performance"><h2>Performance Readiness</h2><div class="grid"><div class="card"><strong>${insights.performance.score}/100</strong><br>Perf score</div><div class="card"><strong>${insights.performance.cacheSignals}</strong><br>Cache signals</div><div class="card"><strong>${insights.performance.unrateLimitedApis}</strong><br>Unrate-limited APIs</div><div class="card"><strong>${insights.performance.bundleRisk}</strong><br>Bundle risk</div></div><table><tr><th>Severity</th><th>Area</th><th>Issue</th><th>Recommendation</th></tr>${perfRows || '<tr><td colspan="4">No performance readiness issues detected.</td></tr>'}</table></section>`;
}
