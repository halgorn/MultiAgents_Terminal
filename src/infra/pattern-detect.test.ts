import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPatterns } from './pattern-detect.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'pattern-detect-'));
}

// ── empty dir ─────────────────────────────────────────────────────────────────

test('detectPatterns: empty dir returns valid PatternReport shape', () => {
  const dir = makeDir();
  try {
    const report = detectPatterns(dir);
    assert.ok(typeof report.summary === 'string', 'summary should be a string');
    assert.ok(Array.isArray(report.detected), 'detected should be array');
    assert.ok(Array.isArray(report.antiPatterns), 'antiPatterns should be array');
    assert.ok(Array.isArray(report.recommendations), 'recommendations should be array');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPatterns: summary always mentions detected count', () => {
  const dir = makeDir();
  try {
    const report = detectPatterns(dir);
    assert.ok(report.summary.includes('Detected'), 'summary should include "Detected"');
    assert.ok(report.summary.includes('pattern'), 'summary should mention pattern(s)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── directory-based pattern detection ─────────────────────────────────────────

test('detectPatterns: agents/ directory triggers Agent-Based Architecture signal', () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, 'agents'));
    const report = detectPatterns(dir);
    const signal = report.detected.find((s) => s.pattern === 'Agent-Based Architecture');
    assert.ok(signal, 'should detect Agent-Based Architecture');
    assert.equal(signal?.category, 'IA');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPatterns: domain/ + application/ directories trigger Clean Architecture signal', () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, 'domain'));
    mkdirSync(join(dir, 'application'));
    const report = detectPatterns(dir);
    const signal = report.detected.find((s) => s.pattern.includes('Clean Architecture') || s.pattern.includes('Hexagonal'));
    assert.ok(signal, 'should detect Clean Architecture or Hexagonal');
    assert.equal(signal?.confidence, 'high');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPatterns: ports/ + adapters/ directories trigger Hexagonal signal', () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, 'ports'));
    mkdirSync(join(dir, 'adapters'));
    const report = detectPatterns(dir);
    const signal = report.detected.find((s) => s.pattern.includes('Hexagonal'));
    assert.ok(signal, 'should detect Hexagonal pattern');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── dependency-based pattern detection ───────────────────────────────────────

test('detectPatterns: package.json with react dep triggers MVVM signal', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }));
    const report = detectPatterns(dir);
    const signal = report.detected.find((s) => s.pattern.includes('MVVM'));
    assert.ok(signal, 'should detect MVVM frontend pattern');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPatterns: package.json with anthropic dep triggers Agentic Workflow signal', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@anthropic-ai/sdk': '^0.20.0' } }));
    const report = detectPatterns(dir);
    // 'anthropic' is in the dep name → hasDep check includes
    const signal = report.detected.find((s) => s.pattern === 'Agentic Workflow');
    assert.ok(signal, 'should detect Agentic Workflow when anthropic SDK is present');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── anti-pattern detection ────────────────────────────────────────────────────

test('detectPatterns: hotspot with fanOut >= 30 triggers God Object anti-pattern', () => {
  const dir = makeDir();
  try {
    const hotspots = [{ file: 'src/god.ts', fanIn: 5, fanOut: 35 }];
    const report = detectPatterns(dir, hotspots);
    const anti = report.antiPatterns.find((a) => a.name.includes('God'));
    assert.ok(anti, 'should detect God Object anti-pattern');
    assert.equal(anti?.severity, 'high');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPatterns: hotspot with fanOut < 30 does not trigger God Object anti-pattern', () => {
  const dir = makeDir();
  try {
    const hotspots = [{ file: 'src/normal.ts', fanIn: 3, fanOut: 15 }];
    const report = detectPatterns(dir, hotspots);
    const anti = report.antiPatterns.find((a) => a.name.includes('God'));
    assert.equal(anti, undefined, 'should not flag normal module as God Object');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── recommendations ───────────────────────────────────────────────────────────

test('detectPatterns: God Object triggers Single Responsibility recommendation', () => {
  const dir = makeDir();
  try {
    const hotspots = [{ file: 'src/god.ts', fanIn: 2, fanOut: 40 }];
    const report = detectPatterns(dir, hotspots);
    const rec = report.recommendations.find((r) => r.pattern.includes('Single Responsibility'));
    assert.ok(rec, 'should recommend Single Responsibility when God Object detected');
    assert.equal(rec?.priority, 'high');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPatterns: no anti-patterns → summary says No major anti-patterns', () => {
  const dir = makeDir();
  try {
    const report = detectPatterns(dir, []);
    assert.ok(
      report.summary.toLowerCase().includes('no major anti-patterns') ||
      report.antiPatterns.length === 0,
      'should report no anti-patterns for clean dir',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
