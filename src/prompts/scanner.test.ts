import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScannerPrompt, SCAN_DOMAINS } from './scanner.js';
import type { ScanDomain } from './scanner.js';

// ── SCAN_DOMAINS ──────────────────────────────────────────────────────────────

test('SCAN_DOMAINS: contains 15 expected domains', () => {
  assert.equal(SCAN_DOMAINS.length, 15);
});

test('SCAN_DOMAINS: includes security and bugs', () => {
  assert.ok(SCAN_DOMAINS.includes('security'), 'should include security');
  assert.ok(SCAN_DOMAINS.includes('bugs'), 'should include bugs');
});

// ── buildScannerPrompt ────────────────────────────────────────────────────────

test('buildScannerPrompt: includes domain in output heading', () => {
  const prompt = buildScannerPrompt('security', 0, 5);
  assert.ok(prompt.includes('Security Scanner') || prompt.includes('security'), 'should name the security domain');
});

test('buildScannerPrompt: includes scanner index and total', () => {
  const prompt = buildScannerPrompt('bugs', 2, 10);
  assert.ok(prompt.includes('3') && prompt.includes('10'), 'should show "3 of 10"');
});

test('buildScannerPrompt: includes JSON output schema instructions', () => {
  const prompt = buildScannerPrompt('security', 0, 1);
  assert.ok(prompt.includes('## Output'), 'should have Output section');
  assert.ok(prompt.includes('JSON'), 'should reference JSON output');
});

test('buildScannerPrompt: includes allowed tools section', () => {
  const prompt = buildScannerPrompt('architecture', 1, 3);
  assert.ok(prompt.includes('## Allowed Tools'), 'should list allowed tools');
});

test('buildScannerPrompt: without ctx does not include Focus your Read calls header', () => {
  const prompt = buildScannerPrompt('performance', 0, 2);
  assert.ok(!prompt.includes('Focus your Read calls on these files first'), 'no ctx → no target-files preamble');
});

test('buildScannerPrompt: ctx with targetFiles includes Target Files section', () => {
  const prompt = buildScannerPrompt('security', 0, 1, { targetFiles: ['src/auth.ts', 'src/utils.ts'] });
  assert.ok(prompt.includes('Target Files'), 'should include Target Files section');
  assert.ok(prompt.includes('src/auth.ts'), 'should list provided target files');
});

test('buildScannerPrompt: ctx with ragContext includes RAG section', () => {
  const prompt = buildScannerPrompt('bugs', 0, 1, { ragContext: 'function foo() { return null; }' });
  assert.ok(prompt.includes('RAG') || prompt.includes('Relevant Code Context'), 'should include RAG context');
});

test('buildScannerPrompt: valid for all SCAN_DOMAINS', () => {
  for (const domain of SCAN_DOMAINS) {
    const prompt = buildScannerPrompt(domain as ScanDomain, 0, 1);
    assert.ok(prompt.length > 100, `prompt for ${domain} should be non-trivial`);
  }
});
