import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeChurn, analyzeBusFactor, totalCommits, gitAuthors, buildChurnReport } from './git-analysis.js';

const PROJECT_DIR = new URL('../../', import.meta.url).pathname;

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'git-analysis-'));
}

// ── non-git directory: all functions return safe defaults ─────────────────────

test('analyzeChurn: non-git dir returns empty array', () => {
  const dir = makeDir();
  try {
    assert.deepEqual(analyzeChurn(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeBusFactor: non-git dir returns empty array', () => {
  const dir = makeDir();
  try {
    assert.deepEqual(analyzeBusFactor(dir, ['src/app.ts']), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('totalCommits: non-git dir returns 0', () => {
  const dir = makeDir();
  try {
    assert.equal(totalCommits(dir), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gitAuthors: non-git dir returns empty array', () => {
  const dir = makeDir();
  try {
    assert.deepEqual(gitAuthors(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildChurnReport: non-git dir returns zero totalCommits and empty arrays', () => {
  const dir = makeDir();
  try {
    const report = buildChurnReport(dir, []);
    assert.equal(report.totalCommits, 0);
    assert.deepEqual(report.churn, []);
    assert.deepEqual(report.busFactor, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildChurnReport: periodDays defaults to 90', () => {
  const dir = makeDir();
  try {
    const report = buildChurnReport(dir, []);
    assert.equal(report.periodDays, 90);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── real git repo: functions succeed ─────────────────────────────────────────

test('totalCommits: real git repo returns > 0 commits', () => {
  const count = totalCommits(PROJECT_DIR);
  assert.ok(count > 0, `expected > 0 commits in project, got ${count}`);
});

test('analyzeChurn: real git repo returns ChurnEntry array with valid shape', () => {
  const entries = analyzeChurn(PROJECT_DIR, 365, 5);
  if (entries.length === 0) return; // no churn data — OK for fresh repos
  const entry = entries[0]!;
  assert.ok(typeof entry.file === 'string', 'file should be a string');
  assert.ok(typeof entry.commits === 'number', 'commits should be a number');
  assert.ok(['critical', 'high', 'medium', 'low'].includes(entry.risk), 'risk should be valid level');
});

test('analyzeChurn: result is sorted descending by commits', () => {
  const entries = analyzeChurn(PROJECT_DIR, 365, 10);
  for (let i = 1; i < entries.length; i++) {
    assert.ok(entries[i - 1]!.commits >= entries[i]!.commits, 'entries should be sorted by commits desc');
  }
});
