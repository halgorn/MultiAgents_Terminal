import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectInsights, renderInsightsMarkdown } from './project-insights.js';
import type { HealthScore } from './health-score.js';

const HEALTH: HealthScore = {
  total: 78,
  grade: 'B',
  badge: '🟡 B',
  topRisks: ['Security: 40/100', 'Test Coverage: 20/100'],
  dimensions: [
    { name: 'Security', score: 40, weight: 0.30, detail: '3 critical findings' },
    { name: 'Architecture', score: 90, weight: 0.20, detail: '0 cycles' },
    { name: 'Test Coverage', score: 20, weight: 0.15, detail: '2% test ratio' },
    { name: 'Churn Risk', score: 80, weight: 0.15, detail: 'low churn' },
    { name: 'Bus Factor', score: 80, weight: 0.10, detail: 'no bottleneck' },
    { name: 'Maintainability', score: 75, weight: 0.10, detail: 'low complexity' },
  ],
};

const SEO = { score: 85, filesChecked: 5, robotsTxt: true, sitemap: true, googleAnalytics: false, googleTagManager: false, searchConsole: false, aiCrawlerPolicy: 'explicit' as const, signals: [], issues: [] };
const DB = { score: 90, filesChecked: 10, ormSignals: ['prisma'], migrationFiles: 5, rawSqlFiles: 0, indexSignals: 2, queryTestSignals: 1, transactionSignals: 1, paginationSignals: 0, poolSignals: 0, relationRiskSignals: 0, unboundedListSignals: 0, issues: [] };
const PERF = { score: 80, filesChecked: 8, cacheSignals: 3, asyncRiskSignals: 1, clientRenderSignals: 0, uncachedFetchSignals: 0, largeAssetFiles: 0, staticAssetSignals: 2, bundleRisk: 'low' as const, unrateLimitedApis: 0, issues: [] };
const LINE = { limit: 500, checkedFiles: 20, oversized: [], score: 100 };

// ── buildProjectInsights ──────────────────────────────────────────────────────

test('buildProjectInsights: includes weak dimensions in scoreReasons', () => {
  const insights = buildProjectInsights({ projectName: 'TestApp', health: HEALTH, seo: SEO, database: DB, performance: PERF, lineSize: LINE, files: 50, hotspots: 2 });
  // Security (40) and Test Coverage (20) are both below 70 threshold
  assert.ok(insights.scoreReasons.some((r) => r.includes('Security')));
  assert.ok(insights.scoreReasons.some((r) => r.includes('Test Coverage')));
});

test('buildProjectInsights: high-scoring dimensions not in scoreReasons', () => {
  const insights = buildProjectInsights({ projectName: 'TestApp', health: HEALTH, seo: SEO, database: DB, performance: PERF, lineSize: LINE, files: 50, hotspots: 2 });
  // Architecture (90) is above 70 — should NOT appear in scoreReasons
  assert.ok(!insights.scoreReasons.some((r) => r.includes('Architecture')));
});

test('buildProjectInsights: domainScores sorted ascending by score', () => {
  const insights = buildProjectInsights({ projectName: 'TestApp', health: HEALTH, seo: SEO, database: DB, performance: PERF, lineSize: LINE, files: 50, hotspots: 2 });
  const scores = insights.domainScores.map((d) => d.score);
  for (let i = 0; i < scores.length - 1; i++) {
    assert.ok(scores[i]! <= scores[i + 1]!, `expected ascending: ${scores[i]} <= ${scores[i + 1]}`);
  }
});

test('buildProjectInsights: scoreActions has at most 5 entries', () => {
  const insights = buildProjectInsights({ projectName: 'TestApp', health: HEALTH, seo: SEO, database: DB, performance: PERF, lineSize: LINE, files: 50, hotspots: 2 });
  assert.ok(insights.scoreActions.length <= 5);
});

test('buildProjectInsights: scoreActions include actionable recommendations for Security', () => {
  const insights = buildProjectInsights({ projectName: 'TestApp', health: HEALTH, seo: SEO, database: DB, performance: PERF, lineSize: LINE, files: 50, hotspots: 2 });
  const securityAction = insights.scoreActions.find((a) => a.name === 'Security');
  assert.ok(securityAction, 'Security should be in top-5 worst domains given score=40');
  assert.ok(securityAction!.detail.includes('critical'), 'security action should mention critical findings');
});

test('buildProjectInsights: linkedinSummary mentions project name', () => {
  const insights = buildProjectInsights({ projectName: 'MyProject', health: HEALTH, seo: SEO, database: DB, performance: PERF, lineSize: LINE, files: 50, hotspots: 2 });
  assert.ok(insights.linkedinSummary.includes('MyProject'));
});

// ── renderInsightsMarkdown ────────────────────────────────────────────────────

test('renderInsightsMarkdown: contains required section headers', () => {
  const insights = buildProjectInsights({ projectName: 'TestApp', health: HEALTH, seo: SEO, database: DB, performance: PERF, lineSize: LINE, files: 50, hotspots: 2 });
  const md = renderInsightsMarkdown(insights);
  assert.ok(md.includes('## Score Explanation') || md.includes('Score Explanation'));
  assert.ok(md.length > 50, 'should produce substantive markdown output');
});
