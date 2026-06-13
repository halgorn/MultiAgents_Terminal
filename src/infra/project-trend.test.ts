import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProjectTrend, saveProjectTrend, renderTrendMarkdown, renderTrendHtml } from './project-trend.js';
import type { HealthScore } from './health-score.js';
import type { SeoCrawlerReport } from './seo-analyzer.js';
import type { DatabaseReport } from './db-analyzer.js';
import type { PerformanceReport } from './performance-analyzer.js';
import type { LineSizeReport } from './line-size-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'project-trend-'));
}

const HEALTH: HealthScore = {
  total: 82,
  grade: 'B',
  badge: '🟡 B',
  topRisks: [],
  dimensions: [],
};

const SEO: SeoCrawlerReport = {
  score: 75, filesChecked: 10, robotsTxt: true, sitemap: false,
  googleAnalytics: false, googleTagManager: false, searchConsole: false,
  aiCrawlerPolicy: 'missing', signals: [], issues: [],
};

const DB: DatabaseReport = {
  score: 90, filesChecked: 5, ormSignals: [], migrationFiles: 0,
  rawSqlFiles: 0, indexSignals: 0, queryTestSignals: 0, transactionSignals: 0,
  paginationSignals: 0, poolSignals: 0, relationRiskSignals: 0, unboundedListSignals: 0, issues: [],
};

const PERF: PerformanceReport = {
  score: 80, filesChecked: 8, cacheSignals: 2, asyncRiskSignals: 0,
  clientRenderSignals: 0, uncachedFetchSignals: 0, largeAssetFiles: 0,
  staticAssetSignals: 1, bundleRisk: 'low', unrateLimitedApis: 0, issues: [],
};

const LINE: LineSizeReport = { limit: 500, checkedFiles: 20, oversized: [], score: 100 };

// ── buildProjectTrend: first run ──────────────────────────────────────────────

test('buildProjectTrend: first run has no previous and baseline message', () => {
  const dir = makeDir();
  try {
    const trend = buildProjectTrend({ cwd: dir, generatedAt: '2026-01-01T00:00:00Z', health: HEALTH, auditCriticals: 0, auditHighs: 0, seo: SEO, database: DB, performance: PERF, lineSize: LINE });
    assert.equal(trend.previous, undefined);
    assert.ok(trend.changes.some((c) => c.includes('baseline')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildProjectTrend: current snapshot reflects input values', () => {
  const dir = makeDir();
  try {
    const trend = buildProjectTrend({ cwd: dir, generatedAt: '2026-01-01T00:00:00Z', health: HEALTH, auditCriticals: 2, auditHighs: 5, seo: SEO, database: DB, performance: PERF, lineSize: LINE });
    assert.equal(trend.current.health, 82);
    assert.equal(trend.current.grade, 'B');
    assert.equal(trend.current.critical, 2);
    assert.equal(trend.current.high, 5);
    assert.equal(trend.current.seo, 75);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── buildProjectTrend: with previous snapshot ─────────────────────────────────

test('buildProjectTrend: shows delta when health improved', () => {
  const dir = makeDir();
  try {
    // Save a previous snapshot with lower health
    const prev = { createdAt: '2026-01-01T00:00:00Z', health: 70, grade: 'B', critical: 3, high: 10, seo: 60, database: 80, performance: 70, oversizedFiles: 2 };
    saveProjectTrend(dir, prev);

    const trend = buildProjectTrend({ cwd: dir, generatedAt: '2026-02-01T00:00:00Z', health: { ...HEALTH, total: 85, grade: 'A' }, auditCriticals: 1, auditHighs: 5, seo: SEO, database: DB, performance: PERF, lineSize: LINE });
    assert.ok(trend.previous !== undefined);
    assert.equal(trend.previous!.health, 70);
    assert.ok(trend.changes.some((c) => c.includes('Health')), `expected health delta, got: ${trend.changes.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildProjectTrend: grade change is reported when grade differs', () => {
  const dir = makeDir();
  try {
    const prev = { createdAt: '2026-01-01T00:00:00Z', health: 65, grade: 'C', critical: 0, high: 0, seo: 70, database: 80, performance: 70, oversizedFiles: 0 };
    saveProjectTrend(dir, prev);

    const trend = buildProjectTrend({ cwd: dir, generatedAt: '2026-02-01T00:00:00Z', health: HEALTH, auditCriticals: 0, auditHighs: 0, seo: SEO, database: DB, performance: PERF, lineSize: LINE });
    assert.ok(trend.changes.some((c) => c.includes('Grade') || c.includes('C') || c.includes('B')), `expected grade change, got: ${trend.changes.join('; ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildProjectTrend: no changes when values are identical', () => {
  const dir = makeDir();
  try {
    const snap = { createdAt: '2026-01-01T00:00:00Z', health: 82, grade: 'B', critical: 0, high: 0, seo: 75, database: 90, performance: 80, oversizedFiles: 0 };
    saveProjectTrend(dir, snap);

    const trend = buildProjectTrend({ cwd: dir, generatedAt: '2026-02-01T00:00:00Z', health: HEALTH, auditCriticals: 0, auditHighs: 0, seo: SEO, database: DB, performance: PERF, lineSize: LINE });
    assert.equal(trend.changes.length, 0, `expected no changes, got: ${trend.changes.join('; ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── renderTrendMarkdown ───────────────────────────────────────────────────────

test('renderTrendMarkdown: contains section header', () => {
  const md = renderTrendMarkdown({ current: {} as never, changes: ['Health score increased by 5 (80 -> 85)'] });
  assert.ok(md.includes('## What Changed'), md);
});

test('renderTrendMarkdown: each change is a bullet point', () => {
  const changes = ['Health improved', 'Criticals reduced'];
  const md = renderTrendMarkdown({ current: {} as never, changes });
  assert.ok(md.includes('- Health improved'), md);
  assert.ok(md.includes('- Criticals reduced'), md);
});

test('renderTrendMarkdown: empty changes shows fallback message', () => {
  const md = renderTrendMarkdown({ current: {} as never, changes: [] });
  assert.ok(md.includes('No score changes'), md);
});

// ── renderTrendHtml ───────────────────────────────────────────────────────────

test('renderTrendHtml: wraps output in <section id="trend">', () => {
  const html = renderTrendHtml({ current: {} as never, changes: ['Some change'] });
  assert.ok(html.includes('<section id="trend">'), html);
});

test('renderTrendHtml: escapes HTML special characters in change text', () => {
  const changes = ['Score <script>alert(1)</script> changed by 5 & it was good'];
  const html = renderTrendHtml({ current: {} as never, changes });
  assert.ok(!html.includes('<script>'), 'raw <script> tag must not appear in output');
  assert.ok(html.includes('&lt;script&gt;'), html);
  assert.ok(html.includes('&amp;'), html);
});
