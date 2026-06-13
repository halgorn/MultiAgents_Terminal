import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeProjectDocs } from './docs-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'docs-analyzer-'));
}

// ── missing required files ────────────────────────────────────────────────────

test('analyzeProjectDocs: empty dir reports missing README as high-severity gap', () => {
  const dir = makeDir();
  try {
    const result = analyzeProjectDocs(dir);
    const readmeGap = result.gaps.find((g) => g.file === 'README.md');
    assert.ok(readmeGap, 'should report missing README.md gap');
    assert.equal(readmeGap?.severity, 'high');
    assert.equal(readmeGap?.type, 'missing-file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeProjectDocs: README.md present removes the missing-file gap', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'README.md'), '# Test\n\n## Installation\nRun npm install.\n\n## Usage\nRun npm start.\n');
    const result = analyzeProjectDocs(dir);
    const readmeGap = result.gaps.find((g) => g.file === 'README.md' && g.type === 'missing-file');
    assert.equal(readmeGap, undefined, 'no missing-file gap when README.md exists');
    assert.ok(result.existingDocs.includes('README.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeProjectDocs: empty dir score is below 100 due to missing high-severity files', () => {
  const dir = makeDir();
  try {
    const result = analyzeProjectDocs(dir);
    assert.ok(result.score < 100, `expected score < 100, got ${result.score}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── README section gaps ───────────────────────────────────────────────────────

test('analyzeProjectDocs: README without Installation section reports missing-section gap', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'README.md'), '# Project\n\nJust a description.\n');
    const result = analyzeProjectDocs(dir);
    const installGap = result.gaps.find((g) => g.type === 'missing-section' && g.description?.includes('Installation'));
    assert.ok(installGap, 'should report missing Installation section');
    assert.equal(installGap?.severity, 'high');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeProjectDocs: README with Installation section has no Installation gap', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'README.md'), '# Project\n\n## Installation\nnpm install\n\n## Usage\nnpm start\n');
    const result = analyzeProjectDocs(dir);
    const installGap = result.gaps.find((g) => g.type === 'missing-section' && g.description?.includes('Installation'));
    assert.equal(installGap, undefined, 'no gap when Installation section exists');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── score ─────────────────────────────────────────────────────────────────────

test('analyzeProjectDocs: score is at least 0', () => {
  const dir = makeDir();
  try {
    const result = analyzeProjectDocs(dir);
    assert.ok(result.score >= 0, 'score should never go negative');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── summary ───────────────────────────────────────────────────────────────────

test('analyzeProjectDocs: summary mentions gap count', () => {
  const dir = makeDir();
  try {
    const result = analyzeProjectDocs(dir);
    assert.ok(result.summary.includes('gap'), `expected "gap" in summary, got: ${result.summary}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeProjectDocs: summary mentions "critical" when high-severity gaps exist', () => {
  const dir = makeDir();
  try {
    const result = analyzeProjectDocs(dir);
    // Empty dir → missing README (high) → summary should say critical
    assert.ok(result.summary.includes('critical'), `expected "critical" in summary, got: ${result.summary}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
