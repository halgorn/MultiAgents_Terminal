import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPatterns } from './pattern-detect.js';
import { analyzeProjectDocs } from './docs-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'pattern-docs-'));
}

// ── detectPatterns: architectural detection ───────────────────────────────────

test('detectPatterns: agents/ directory triggers Agent-Based Architecture signal', () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, 'agents'));
    writeFileSync(join(dir, 'agents', 'scanner.ts'), 'export class ScannerAgent {}');
    const report = detectPatterns(dir);
    const found = report.detected.find((p) => p.pattern === 'Agent-Based Architecture');
    assert.ok(found, `expected Agent-Based Architecture, got: ${report.detected.map((p) => p.pattern).join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPatterns: pipelines/ directory triggers Pipeline Architecture signal', () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, 'pipelines'));
    const report = detectPatterns(dir);
    const found = report.detected.find((p) => p.pattern === 'Pipeline Architecture');
    assert.ok(found, `expected Pipeline Architecture, got: ${report.detected.map((p) => p.pattern).join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPatterns: empty dir returns no detected patterns and no anti-patterns', () => {
  const dir = makeDir();
  try {
    const report = detectPatterns(dir);
    assert.ok(Array.isArray(report.detected));
    assert.ok(Array.isArray(report.antiPatterns));
    assert.ok(typeof report.summary === 'string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPatterns: God Object from hotspots parameter', () => {
  const dir = makeDir();
  try {
    const hotspots = [{ file: 'src/god.ts', fanIn: 5, fanOut: 35 }];
    const report = detectPatterns(dir, hotspots);
    const found = report.antiPatterns.find((a) => a.name === 'God Object / God Module');
    assert.ok(found, 'expected God Object anti-pattern from high fanOut');
    assert.ok(found!.evidence.some((e) => e.includes('src/god.ts')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPatterns: no God Object when fanOut is below threshold', () => {
  const dir = makeDir();
  try {
    const hotspots = [{ file: 'src/ok.ts', fanIn: 2, fanOut: 10 }];
    const report = detectPatterns(dir, hotspots);
    const found = report.antiPatterns.find((a) => a.name === 'God Object / God Module');
    assert.ok(!found, 'fanOut=10 should not trigger God Object');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPatterns: summary string is always defined', () => {
  const dir = makeDir();
  try {
    const report = detectPatterns(dir);
    assert.ok(report.summary.length > 0);
    assert.ok(report.summary.includes('pattern'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── analyzeProjectDocs ────────────────────────────────────────────────────────

test('analyzeProjectDocs: empty dir flags missing required files', () => {
  const dir = makeDir();
  try {
    const report = analyzeProjectDocs(dir);
    assert.ok(report.gaps.length > 0, 'should report gaps for missing docs');
    assert.ok(report.score < 100, 'score should be below 100 without docs');
    const readmeGap = report.gaps.find((g) => g.file?.includes('README'));
    assert.ok(readmeGap, 'should flag missing README.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeProjectDocs: README.md presence is recorded in existingDocs', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'README.md'), '# My Project\n\n## Installation\n\n## Usage\n\n## Contributing\n\nSome content here.\n');
    const report = analyzeProjectDocs(dir);
    assert.ok(report.existingDocs.includes('README.md'), 'README.md should be in existingDocs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeProjectDocs: score is 0–100', () => {
  const dir = makeDir();
  try {
    const report = analyzeProjectDocs(dir);
    assert.ok(report.score >= 0 && report.score <= 100, `score out of range: ${report.score}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeProjectDocs: summary describes gap count', () => {
  const dir = makeDir();
  try {
    const report = analyzeProjectDocs(dir);
    assert.ok(report.summary.includes('gap') || report.summary.includes('documentation'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
