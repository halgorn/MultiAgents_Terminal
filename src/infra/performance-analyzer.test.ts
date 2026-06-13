import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzePerformance } from './performance-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'perf-analyzer-'));
}

// ── caching signals ───────────────────────────────────────────────────────────

test('analyzePerformance: empty dir reports missing cache strategy', () => {
  const dir = makeDir();
  try {
    const result = analyzePerformance(dir, []);
    const cacheIssue = result.issues.find((i) => i.area === 'Caching');
    assert.ok(cacheIssue, 'should report missing cache strategy for empty dir');
    assert.equal(cacheIssue?.severity, 'medium');
    assert.equal(result.cacheSignals, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzePerformance: file with redis keyword removes caching issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'cache.ts'), 'const client = redis.createClient();\n');
    const result = analyzePerformance(dir, []);
    const cacheIssue = result.issues.find((i) => i.area === 'Caching');
    assert.equal(cacheIssue, undefined, 'redis presence should remove caching issue');
    assert.ok(result.cacheSignals > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── sync I/O signals ──────────────────────────────────────────────────────────

test('analyzePerformance: file with readFileSync detects sync I/O signal', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'handler.ts'), "import { readFileSync } from 'fs';\nconst data = readFileSync('file.txt', 'utf8');\n");
    const result = analyzePerformance(dir, []);
    const syncIssue = result.issues.find((i) => i.area === 'Runtime blocking');
    assert.ok(syncIssue, 'should detect sync I/O issue');
    assert.ok(result.asyncRiskSignals > 0, 'asyncRiskSignals should increase');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── client render signals ─────────────────────────────────────────────────────

test('analyzePerformance: "use client" directive increments clientRenderSignals', () => {
  const dir = makeDir();
  try {
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, `comp${i}.tsx`), `'use client';\nexport default function C${i}() { return null; }\n`);
    }
    const result = analyzePerformance(dir, []);
    assert.ok(result.clientRenderSignals >= 5, `expected ≥5 client signals, got ${result.clientRenderSignals}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── uncached fetch signals ────────────────────────────────────────────────────

test('analyzePerformance: fetch without cache option increments uncachedFetchSignals', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'api.ts'), "const data = await fetch('https://api.example.com/data');\n");
    const result = analyzePerformance(dir, []);
    assert.ok(result.uncachedFetchSignals > 0, 'should detect uncached fetch');
    assert.ok(result.issues.some((i) => i.area === 'Data fetching'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── API rate limit signals ────────────────────────────────────────────────────

test('analyzePerformance: endpoints without rate limit generate API pressure issue', () => {
  const dir = makeDir();
  try {
    const endpoints = [
      { method: 'GET' as const, path: '/api/users', hasRateLimit: false },
      { method: 'POST' as const, path: '/api/items', hasRateLimit: false },
    ];
    const result = analyzePerformance(dir, endpoints);
    const apiIssue = result.issues.find((i) => i.area === 'API pressure');
    assert.ok(apiIssue, 'should report API pressure issue');
    assert.equal(result.unrateLimitedApis, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzePerformance: endpoints with rate limit produce no API pressure issue', () => {
  const dir = makeDir();
  try {
    const endpoints = [
      { method: 'GET' as const, path: '/api/users', hasRateLimit: true },
    ];
    const result = analyzePerformance(dir, endpoints);
    const apiIssue = result.issues.find((i) => i.area === 'API pressure');
    assert.equal(apiIssue, undefined, 'no API pressure issue when rate-limited');
    assert.equal(result.unrateLimitedApis, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── score calculation ─────────────────────────────────────────────────────────

test('analyzePerformance: score never goes below 0', () => {
  const dir = makeDir();
  try {
    // Trigger as many issues as possible
    writeFileSync(join(dir, 'sync.ts'), "readFileSync('x');\n");
    const endpoints = Array.from({ length: 20 }, (_, i) => ({
      method: 'GET' as const,
      path: `/api/route${i}`,
      hasRateLimit: false,
    }));
    const result = analyzePerformance(dir, endpoints);
    assert.ok(result.score >= 0, `score should never be negative, got ${result.score}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── bundleRisk ────────────────────────────────────────────────────────────────

test('analyzePerformance: package.json with "next" → bundleRisk medium', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
    const result = analyzePerformance(dir, []);
    assert.equal(result.bundleRisk, 'medium');
    assert.ok(result.issues.some((i) => i.area === 'Bundle/runtime' && i.issue.includes('budget')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzePerformance: package.json without bundler → bundleRisk low', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '4.0.0' } }));
    const result = analyzePerformance(dir, []);
    assert.equal(result.bundleRisk, 'low');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
