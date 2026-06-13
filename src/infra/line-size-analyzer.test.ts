import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeLineSize } from './line-size-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'line-size-'));
}

function write(dir: string, name: string, lines: number): void {
  writeFileSync(join(dir, name), Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n'));
}

// ── analyzeLineSize: empty / non-source files ─────────────────────────────────

test('analyzeLineSize: empty dir returns score 100 and no oversized files', () => {
  const dir = makeDir();
  try {
    const result = analyzeLineSize(dir, 500);
    assert.equal(result.score, 100);
    assert.equal(result.oversized.length, 0);
    assert.equal(result.checkedFiles, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeLineSize: non-source file (README.md) is not counted', () => {
  const dir = makeDir();
  try {
    write(dir, 'README.md', 1000);
    const result = analyzeLineSize(dir, 500);
    // .md is not a source extension — should not be counted
    assert.equal(result.oversized.length, 0);
    assert.equal(result.checkedFiles, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── analyzeLineSize: source file detection ────────────────────────────────────

test('analyzeLineSize: source file under limit is counted but not oversized', () => {
  const dir = makeDir();
  try {
    write(dir, 'app.ts', 100);
    const result = analyzeLineSize(dir, 500);
    assert.equal(result.checkedFiles, 1);
    assert.equal(result.oversized.length, 0);
    assert.equal(result.score, 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeLineSize: source file at exactly the limit is not oversized', () => {
  const dir = makeDir();
  try {
    write(dir, 'app.ts', 500);
    const result = analyzeLineSize(dir, 500);
    assert.equal(result.oversized.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeLineSize: source file one line over limit appears in oversized', () => {
  const dir = makeDir();
  try {
    write(dir, 'app.ts', 501);
    const result = analyzeLineSize(dir, 500);
    assert.equal(result.oversized.length, 1);
    assert.equal(result.oversized[0]?.file, 'app.ts');
    assert.equal(result.oversized[0]?.overBy, 1);
    assert.equal(result.oversized[0]?.lines, 501);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── analyzeLineSize: sorting ──────────────────────────────────────────────────

test('analyzeLineSize: oversized files sorted by overBy descending', () => {
  const dir = makeDir();
  try {
    write(dir, 'small.ts', 510);  // overBy 10
    write(dir, 'large.ts', 700);  // overBy 200
    const result = analyzeLineSize(dir, 500);
    assert.equal(result.oversized.length, 2);
    assert.equal(result.oversized[0]?.file, 'large.ts');
    assert.equal(result.oversized[1]?.file, 'small.ts');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── analyzeLineSize: score calculation ────────────────────────────────────────

test('analyzeLineSize: score decreases with oversized files', () => {
  const dir = makeDir();
  try {
    write(dir, 'a.ts', 600); // overBy 100 → ceil(100/100)=1, penalty=10+1=11
    const result = analyzeLineSize(dir, 500);
    assert.ok(result.score < 100, `score should drop below 100, got ${result.score}`);
    assert.ok(result.score >= 40, `score should not drop below 40, got ${result.score}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeLineSize: score never drops below 40', () => {
  const dir = makeDir();
  try {
    // 10 oversized files: penalty capped at 60 → score = max(40, 40) = 40
    for (let i = 0; i < 10; i++) write(dir, `file${i}.ts`, 2000);
    const result = analyzeLineSize(dir, 500);
    assert.ok(result.score >= 40, `score minimum should be 40, got ${result.score}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeLineSize: custom limit is respected', () => {
  const dir = makeDir();
  try {
    write(dir, 'app.ts', 200);
    const result = analyzeLineSize(dir, 100);
    assert.equal(result.limit, 100);
    assert.equal(result.oversized.length, 1);
    assert.equal(result.oversized[0]?.overBy, 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
