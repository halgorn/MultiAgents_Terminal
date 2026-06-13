import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectLang, resolveCommands } from './lang-detect.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'lang-detect-'));
}

// ── detectLang: marker-based ──────────────────────────────────────────────────

test('detectLang: package.json → typescript profile', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), '{}');
    const profile = detectLang(dir);
    assert.equal(profile.lang, 'typescript');
    assert.ok(profile.testCommand.includes('npm'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectLang: go.mod → go profile', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'go.mod'), 'module example.com/app\n\ngo 1.21\n');
    const profile = detectLang(dir);
    assert.equal(profile.lang, 'go');
    assert.ok(profile.testCommand.includes('go test'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectLang: Cargo.toml → rust profile', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "app"\n');
    const profile = detectLang(dir);
    assert.equal(profile.lang, 'rust');
    assert.ok(profile.testCommand.includes('cargo test'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectLang: requirements.txt → python profile', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'requirements.txt'), 'flask>=2.0\n');
    const profile = detectLang(dir);
    assert.equal(profile.lang, 'python');
    assert.ok(profile.testCommand.includes('pytest'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectLang: Gemfile → ruby profile', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'Gemfile'), 'source "https://rubygems.org"\n');
    const profile = detectLang(dir);
    assert.equal(profile.lang, 'ruby');
    assert.ok(profile.testCommand.includes('rspec'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectLang: no markers → unknown profile', () => {
  const dir = makeDir();
  try {
    const profile = detectLang(dir);
    assert.equal(profile.lang, 'unknown');
    assert.equal(profile.packageFile, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── detectLang: extension fallback ───────────────────────────────────────────

test('detectLang: dominant .py files fallback → python profile', () => {
  const dir = makeDir();
  try {
    const src = join(dir, 'src');
    mkdirSync(src);
    for (let i = 0; i < 5; i++) writeFileSync(join(src, `module${i}.py`), '');
    const profile = detectLang(dir);
    assert.equal(profile.lang, 'python');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── resolveCommands ───────────────────────────────────────────────────────────

test('resolveCommands: explicit overrides take precedence', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'package.json'), '{}');
    const { buildCommand, testCommand } = resolveCommands(dir, 'make build', 'make test');
    assert.equal(buildCommand, 'make build');
    assert.equal(testCommand, 'make test');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveCommands: falls back to detected profile commands', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'go.mod'), 'module example.com/app\n');
    const { testCommand } = resolveCommands(dir);
    assert.ok(testCommand.includes('go test'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
