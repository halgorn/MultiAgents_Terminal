import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSbom, formatSbomReport } from './sbom.js';
import { analyzeSeoAndCrawlers } from './seo-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'sbom-seo-'));
}

// ── buildSbom ─────────────────────────────────────────────────────────────────

test('buildSbom: empty dir returns empty report', () => {
  const dir = makeDir();
  try {
    const report = buildSbom(dir);
    assert.equal(report.totalCount, 0);
    assert.deepEqual(report.packages, []);
    assert.deepEqual(report.unpinned, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSbom: package.json dependencies are parsed as node packages', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'express': '^4.18.0', 'zod': '3.22.0' },
    }));
    const report = buildSbom(dir);
    assert.ok(report.totalCount >= 2);
    const langs = report.packages.map((p) => p.lang);
    assert.ok(langs.every((l) => l === 'node'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSbom: caret version is flagged as unpinned', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'lodash': '^4.17.21' },
    }));
    const report = buildSbom(dir);
    assert.equal(report.unpinned.length, 1);
    assert.equal(report.unpinned[0]!.name, 'lodash');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSbom: exact version is pinned', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'react': '18.2.0' },
    }));
    const report = buildSbom(dir);
    assert.equal(report.unpinned.length, 0);
    assert.ok(report.packages[0]!.pinned);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSbom: requirements.txt with pinned version is parsed', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'requirements.txt'), 'flask==2.3.0\nrequests>=2.31.0\n');
    const report = buildSbom(dir);
    const flask = report.packages.find((p) => p.name === 'flask');
    assert.ok(flask, 'flask should be in SBOM');
    assert.equal(flask!.lang, 'python');
    assert.equal(flask!.pinned, true);
    const requests = report.packages.find((p) => p.name === 'requests');
    assert.ok(requests);
    assert.equal(requests!.pinned, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSbom: go.mod packages are all marked as pinned', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'go.mod'), [
      'module example.com/app',
      '',
      'go 1.21',
      '',
      'require (',
      '\tgithub.com/gin-gonic/gin v1.9.1',
      '\tgithub.com/stretchr/testify v1.8.4',
      ')',
    ].join('\n'));
    const report = buildSbom(dir);
    assert.ok(report.totalCount >= 2, `expected ≥2 packages, got ${report.totalCount}`);
    assert.ok(report.packages.every((p) => p.pinned), 'go.mod packages should all be pinned');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSbom: deduplicates same package across deps and devDeps', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'typescript': '5.0.0' },
      devDependencies: { 'typescript': '5.0.0' },
    }));
    const report = buildSbom(dir);
    const ts = report.packages.filter((p) => p.name === 'typescript');
    assert.equal(ts.length, 1, 'should deduplicate same package');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── formatSbomReport ──────────────────────────────────────────────────────────

test('formatSbomReport: output includes total count and languages', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'express': '^4.18.0' } }));
    const report = buildSbom(dir);
    const text = formatSbomReport(report);
    assert.ok(text.includes('node'), 'language should appear in format output');
    assert.ok(text.length > 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── analyzeSeoAndCrawlers ─────────────────────────────────────────────────────

test('analyzeSeoAndCrawlers: empty dir has no robots, no sitemap, missing AI policy', () => {
  const dir = makeDir();
  try {
    const report = analyzeSeoAndCrawlers(dir);
    assert.equal(report.robotsTxt, false);
    assert.equal(report.sitemap, false);
    assert.equal(report.aiCrawlerPolicy, 'missing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeSeoAndCrawlers: robots.txt in public/ detected', () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, 'public'));
    writeFileSync(join(dir, 'public', 'robots.txt'), 'User-agent: *\nAllow: /\n');
    const report = analyzeSeoAndCrawlers(dir);
    assert.equal(report.robotsTxt, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeSeoAndCrawlers: sitemap.xml in public/ detected', () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, 'public'));
    writeFileSync(join(dir, 'public', 'sitemap.xml'), '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    const report = analyzeSeoAndCrawlers(dir);
    assert.equal(report.sitemap, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeSeoAndCrawlers: robots.txt with 1 AI bot → partial policy', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'robots.txt'), 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n');
    const report = analyzeSeoAndCrawlers(dir);
    assert.equal(report.robotsTxt, true);
    assert.notEqual(report.aiCrawlerPolicy, 'missing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
