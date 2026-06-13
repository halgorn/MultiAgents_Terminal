import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTrend, appendTrend } from './audit-trend.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'trend-'));
}

// ── loadTrend ─────────────────────────────────────────────────────────────────

test('loadTrend: returns empty trend when no file exists', () => {
  const dir = makeDir();
  try {
    const trend = loadTrend(dir);
    assert.equal(trend.version, 1);
    assert.deepEqual(trend.entries, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTrend: rejects trend file with wrong version', () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, '.ai-runtime'), { recursive: true });
    writeFileSync(
      join(dir, '.ai-runtime', 'health-trend.json'),
      JSON.stringify({ version: 2, entries: [{ score: 90 }] }),
    );
    const trend = loadTrend(dir);
    assert.deepEqual(trend.entries, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTrend: reads valid v1 trend file', () => {
  const dir = makeDir();
  try {
    const data = { version: 1, entries: [{ timestamp: '2026-01-01T00:00:00Z', score: 80, grade: 'B', dimensions: {} }] };
    mkdirSync(join(dir, '.ai-runtime'), { recursive: true });
    writeFileSync(join(dir, '.ai-runtime', 'health-trend.json'), JSON.stringify(data));
    const trend = loadTrend(dir);
    assert.equal(trend.entries.length, 1);
    assert.equal(trend.entries[0]!.score, 80);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── appendTrend ───────────────────────────────────────────────────────────────

test('appendTrend: adds entry and persists to disk', () => {
  const dir = makeDir();
  try {
    appendTrend(dir, { timestamp: '2026-01-01T00:00:00Z', score: 75, grade: 'B', dimensions: { Security: 60 } });
    const trend = loadTrend(dir);
    assert.equal(trend.entries.length, 1);
    assert.equal(trend.entries[0]!.score, 75);
    assert.equal(trend.entries[0]!.grade, 'B');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appendTrend: accumulates multiple entries in order', () => {
  const dir = makeDir();
  try {
    appendTrend(dir, { timestamp: '2026-01-01T00:00:00Z', score: 70, grade: 'B', dimensions: {} });
    appendTrend(dir, { timestamp: '2026-01-02T00:00:00Z', score: 80, grade: 'B', dimensions: {} });
    const trend = loadTrend(dir);
    assert.equal(trend.entries.length, 2);
    assert.equal(trend.entries[0]!.score, 70);
    assert.equal(trend.entries[1]!.score, 80);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appendTrend: gracefully handles non-git directory (no gitSha/gitBranch)', () => {
  const dir = makeDir();
  try {
    // Non-git dir: git commands fail, entry still written without git fields
    appendTrend(dir, { timestamp: '2026-01-01T00:00:00Z', score: 85, grade: 'A', dimensions: {} });
    const trend = loadTrend(dir);
    assert.equal(trend.entries.length, 1);
    // gitSha and gitBranch may be undefined when git is unavailable
    assert.ok(trend.entries[0]!.score === 85);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
