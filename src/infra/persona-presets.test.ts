import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDomains, resolvePreset, resolveDomainsFromConfig, BUILT_IN_PRESETS } from './persona-presets.js';

// ── parseDomains ──────────────────────────────────────────────────────────────

test('parseDomains: valid domains are accepted', () => {
  const domains = parseDomains('security,bugs,architecture');
  assert.deepEqual(domains, ['security', 'bugs', 'architecture']);
});

test('parseDomains: invalid domains are silently filtered', () => {
  const domains = parseDomains('security,not-a-domain,bugs');
  assert.deepEqual(domains, ['security', 'bugs']);
});

test('parseDomains: whitespace around commas is trimmed', () => {
  const domains = parseDomains(' security , bugs ');
  assert.deepEqual(domains, ['security', 'bugs']);
});

test('parseDomains: empty string returns empty array', () => {
  assert.deepEqual(parseDomains(''), []);
});

test('parseDomains: all-invalid input returns empty array', () => {
  assert.deepEqual(parseDomains('foo,bar,baz'), []);
});

// ── resolvePreset ─────────────────────────────────────────────────────────────

test('resolvePreset: returns built-in preset by name', () => {
  // Pick the first available built-in preset name
  const presetName = Object.keys(BUILT_IN_PRESETS)[0];
  if (!presetName) return; // no built-ins defined — skip
  const preset = resolvePreset(presetName);
  assert.ok(preset !== null);
  assert.ok(Array.isArray(preset?.domains));
  assert.ok(preset!.domains.length > 0);
});

test('resolvePreset: returns null for unknown preset', () => {
  assert.equal(resolvePreset('no-such-preset-xyz'), null);
});

// ── resolveDomainsFromConfig ──────────────────────────────────────────────────

test('resolveDomainsFromConfig: explicit domains argument takes priority', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persona-'));
  try {
    const { domains, source } = resolveDomainsFromConfig(dir, undefined, 'security,bugs');
    assert.deepEqual(domains, ['security', 'bugs']);
    assert.ok(source.includes('custom'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveDomainsFromConfig: unknown preset falls through to auto', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persona-'));
  try {
    const { domains, source } = resolveDomainsFromConfig(dir, 'nonexistent-preset-xyz');
    assert.equal(source, 'auto');
    assert.deepEqual(domains, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveDomainsFromConfig: custom persona file overrides built-in preset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persona-'));
  try {
    const config = {
      presets: {
        'my-preset': { domains: ['security', 'observability'], description: 'custom' },
      },
    };
    writeFileSync(join(dir, '.ai-personas.json'), JSON.stringify(config));
    const { domains, source } = resolveDomainsFromConfig(dir, 'my-preset');
    assert.deepEqual(domains, ['security', 'observability']);
    assert.ok(source.includes('custom'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
