import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSbom, formatSbomReport } from './sbom.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'sbom-'));
}

// ── buildSbom: empty / no manifest ────────────────────────────────────────────

test('buildSbom: empty dir returns zero packages', () => {
  const dir = makeDir();
  try {
    const result = buildSbom(dir);
    assert.equal(result.totalCount, 0);
    assert.equal(result.packages.length, 0);
    assert.equal(result.unpinned.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Python requirements.txt ───────────────────────────────────────────────────

test('buildSbom: requirements.txt with pinned dep → pinned=true', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'requirements.txt'), 'requests==2.31.0\n');
    const result = buildSbom(dir);
    const pkg = result.packages.find((p) => p.name === 'requests');
    assert.ok(pkg, 'should parse requests');
    assert.equal(pkg?.lang, 'python');
    assert.equal(pkg?.version, '2.31.0');
    assert.equal(pkg?.pinned, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSbom: requirements.txt with range spec → pinned=false', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'requirements.txt'), 'flask>=2.0\n');
    const result = buildSbom(dir);
    const pkg = result.packages.find((p) => p.name === 'flask');
    assert.ok(pkg, 'should parse flask');
    assert.equal(pkg?.pinned, false);
    assert.ok(result.unpinned.some((p) => p.name === 'flask'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSbom: requirements.txt skips comment lines and empty lines', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'requirements.txt'), '# This is a comment\n\ndjango==4.2.0\n');
    const result = buildSbom(dir);
    assert.equal(result.totalCount, 1, 'should only count django, not the comment');
    assert.equal(result.packages[0]?.name, 'django');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Node package.json ─────────────────────────────────────────────────────────

test('buildSbom: package.json with ^ version → node lang, unpinned', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '^4.18.2' } }));
    const result = buildSbom(dir);
    const pkg = result.packages.find((p) => p.name === 'express');
    assert.ok(pkg, 'should parse express');
    assert.equal(pkg?.lang, 'node');
    assert.equal(pkg?.pinned, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSbom: package.json with exact version → pinned=true', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { zod: '3.22.4' } }));
    const result = buildSbom(dir);
    const pkg = result.packages.find((p) => p.name === 'zod');
    assert.ok(pkg, 'should parse zod');
    assert.equal(pkg?.pinned, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── go.mod ────────────────────────────────────────────────────────────────────

test('buildSbom: go.mod require lines → go lang, pinned=true', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'go.mod'), 'module example.com/app\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n)\n');
    const result = buildSbom(dir);
    const pkg = result.packages.find((p) => p.name === 'github.com/gin-gonic/gin');
    assert.ok(pkg, 'should parse go dependency');
    assert.equal(pkg?.lang, 'go');
    assert.equal(pkg?.pinned, true);
    assert.equal(pkg?.version, 'v1.9.1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Cargo.toml ────────────────────────────────────────────────────────────────

test('buildSbom: Cargo.toml [dependencies] → rust lang', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'Cargo.toml'), '[dependencies]\nserde = "1.0.193"\n');
    const result = buildSbom(dir);
    const pkg = result.packages.find((p) => p.name === 'serde');
    assert.ok(pkg, 'should parse serde');
    assert.equal(pkg?.lang, 'rust');
    assert.equal(pkg?.version, '1.0.193');
    assert.equal(pkg?.pinned, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── deduplication ─────────────────────────────────────────────────────────────

test('buildSbom: same package in requirements.txt and requirements-dev.txt counted once', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'requirements.txt'), 'pytest==7.4.0\n');
    writeFileSync(join(dir, 'requirements-dev.txt'), 'pytest==7.4.0\n');
    const result = buildSbom(dir);
    const count = result.packages.filter((p) => p.name === 'pytest').length;
    assert.equal(count, 1, 'should deduplicate by name+lang');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── formatSbomReport ──────────────────────────────────────────────────────────

test('formatSbomReport: header includes total count and lang', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'requirements.txt'), 'requests==2.31.0\n');
    const report = buildSbom(dir);
    const text = formatSbomReport(report);
    assert.ok(text.includes('1'), 'should include package count');
    assert.ok(text.includes('python'), 'should include language');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatSbomReport: lists unpinned packages', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'requirements.txt'), 'flask>=2.0\n');
    const report = buildSbom(dir);
    const text = formatSbomReport(report);
    assert.ok(text.includes('flask'), 'unpinned flask should appear in report');
    assert.ok(text.toLowerCase().includes('unpinned'), 'should label unpinned section');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
