import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeLineSize } from './line-size-analyzer.js';
import { analyzeDatabase } from './db-analyzer.js';
import { analyzePerformance } from './performance-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'analyzers-'));
}

function writeSrc(dir: string, name: string, content: string): void {
  const src = join(dir, 'src');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, name), content);
}

// ── analyzeLineSize ───────────────────────────────────────────────────────────

test('analyzeLineSize: empty dir scores 100', () => {
  const dir = makeDir();
  try {
    const report = analyzeLineSize(dir);
    assert.equal(report.score, 100);
    assert.equal(report.oversized.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeLineSize: file under limit not flagged', () => {
  const dir = makeDir();
  try {
    writeSrc(dir, 'small.ts', Array(50).fill('const x = 1;').join('\n'));
    const report = analyzeLineSize(dir, 500);
    assert.equal(report.oversized.length, 0);
    assert.equal(report.score, 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeLineSize: file over limit is flagged with overBy count', () => {
  const dir = makeDir();
  try {
    const lines = Array(600).fill('const x = 1;').join('\n');
    writeSrc(dir, 'big.ts', lines);
    const report = analyzeLineSize(dir, 500);
    assert.equal(report.oversized.length, 1);
    assert.ok(report.oversized[0]!.overBy > 0);
    assert.ok(report.score < 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeLineSize: generated files are excluded', () => {
  const dir = makeDir();
  try {
    writeSrc(dir, 'app.min.js', Array(600).fill('x=1;').join('\n'));
    const report = analyzeLineSize(dir, 500);
    assert.equal(report.oversized.length, 0, 'minified file should be excluded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── analyzeDatabase ───────────────────────────────────────────────────────────

test('analyzeDatabase: empty dir returns no ORM signals', () => {
  const dir = makeDir();
  try {
    const report = analyzeDatabase(dir);
    assert.deepEqual(report.ormSignals, []);
    assert.equal(report.rawSqlFiles, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDatabase: Prisma client import signals ORM usage', () => {
  const dir = makeDir();
  try {
    writeSrc(dir, 'db.ts', "import { PrismaClient } from '@prisma/client';\nconst prisma = new PrismaClient();\n");
    const report = analyzeDatabase(dir);
    assert.ok(report.ormSignals.length > 0, `expected prisma ORM signal, got: ${report.ormSignals.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDatabase: raw SQL usage detected', () => {
  const dir = makeDir();
  try {
    writeSrc(dir, 'user-repo.ts', 'const users = await db.query("SELECT * FROM users WHERE id = $1", [id]);');
    const report = analyzeDatabase(dir);
    assert.ok(report.rawSqlFiles >= 1, 'raw SQL query should be flagged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── analyzePerformance ────────────────────────────────────────────────────────

test('analyzePerformance: empty dir returns zeroed report', () => {
  const dir = makeDir();
  try {
    const report = analyzePerformance(dir, []);
    assert.equal(report.cacheSignals, 0);
    assert.equal(report.asyncRiskSignals, 0);
    assert.ok(report.score >= 0 && report.score <= 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzePerformance: cache usage is detected as a positive signal', () => {
  const dir = makeDir();
  try {
    writeSrc(dir, 'cache.ts', 'import { redis } from "./redis";\nconst cached = await redis.get(key);');
    const report = analyzePerformance(dir, []);
    assert.ok(report.cacheSignals >= 1, 'redis cache usage should be detected');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzePerformance: await-in-loop is a risk signal', () => {
  const dir = makeDir();
  try {
    writeSrc(dir, 'risk.ts', 'for (const item of items) {\n  const result = await fetchItem(item);\n}');
    const report = analyzePerformance(dir, []);
    assert.ok(report.asyncRiskSignals >= 1, 'await-in-loop should be a risk signal');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
