import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeNextSeo, CRAWLERS } from './seo-next-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'seo-next-'));
}

// ── CRAWLERS constant ─────────────────────────────────────────────────────────

test('CRAWLERS: includes major AI crawlers', () => {
  assert.ok(CRAWLERS.includes('GPTBot'), 'must include GPTBot');
  assert.ok(CRAWLERS.includes('ClaudeBot'), 'must include ClaudeBot');
  assert.ok(CRAWLERS.includes('Googlebot'), 'must include Googlebot');
  assert.ok(CRAWLERS.length >= 5, `expected ≥5 crawlers, got ${CRAWLERS.length}`);
});

// ── analyzeNextSeo: non-Next.js project ──────────────────────────────────────

test('analyzeNextSeo: non-Next.js dir returns empty routes', () => {
  const dir = makeDir();
  try {
    const result = analyzeNextSeo(dir, '');
    assert.ok(Array.isArray(result.routes), 'routes should be an array');
    assert.equal(result.routes.length, 0);
    assert.equal(result.framework, undefined, 'non-Next.js should have no framework');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeNextSeo: non-Next.js still returns crawlerPolicies', () => {
  const dir = makeDir();
  try {
    const result = analyzeNextSeo(dir, '');
    assert.ok(Array.isArray(result.crawlerPolicies));
    assert.equal(result.crawlerPolicies.length, CRAWLERS.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── analyzeNextSeo: Next.js detection ────────────────────────────────────────

test('analyzeNextSeo: package.json with "next" dependency → detected as Next.js', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
    const result = analyzeNextSeo(dir, '');
    assert.equal(result.framework, 'next');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeNextSeo: next.config.js presence → detected as Next.js', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'next.config.js'), 'module.exports = {}');
    const result = analyzeNextSeo(dir, '');
    assert.equal(result.framework, 'next');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── analyzeNextSeo: crawlerPolicies from robots.txt ───────────────────────────

test('analyzeNextSeo: GPTBot disallow → status block', () => {
  const dir = makeDir();
  try {
    const robots = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
    const result = analyzeNextSeo(dir, robots);
    const gpt = result.crawlerPolicies.find((p) => p.crawler === 'GPTBot');
    assert.ok(gpt, 'GPTBot should be in crawlerPolicies');
    assert.equal(gpt!.status, 'block');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeNextSeo: ClaudeBot allow (no disallow) → status allow', () => {
  const dir = makeDir();
  try {
    const robots = 'User-agent: ClaudeBot\nAllow: /\n';
    const result = analyzeNextSeo(dir, robots);
    const claude = result.crawlerPolicies.find((p) => p.crawler === 'ClaudeBot');
    assert.ok(claude, 'ClaudeBot should be in crawlerPolicies');
    assert.equal(claude!.status, 'allow');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeNextSeo: unlisted crawler → status missing', () => {
  const dir = makeDir();
  try {
    const robots = 'User-agent: *\nAllow: /\n';
    const result = analyzeNextSeo(dir, robots);
    const gpt = result.crawlerPolicies.find((p) => p.crawler === 'GPTBot');
    assert.equal(gpt!.status, 'missing', 'GPTBot not mentioned → missing policy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── analyzeNextSeo: route detection ──────────────────────────────────────────

test('analyzeNextSeo: app router page.tsx creates a route', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
    mkdirSync(join(dir, 'app', 'about'), { recursive: true });
    writeFileSync(join(dir, 'app', 'about', 'page.tsx'), 'export default function About() { return <div>About</div>; }');
    const result = analyzeNextSeo(dir, '');
    assert.equal(result.framework, 'next');
    assert.ok(result.sourceRoutes.includes('/about'), `expected /about in sourceRoutes, got: ${result.sourceRoutes.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeNextSeo: root app page.tsx maps to / route', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app', 'page.tsx'), 'export default function Home() { return <div>Home</div>; }');
    const result = analyzeNextSeo(dir, '');
    assert.ok(result.sourceRoutes.includes('/'), `expected / in sourceRoutes, got: ${result.sourceRoutes.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
