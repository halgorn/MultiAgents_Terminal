import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapUntrusted,
  wrapUntrustedMulti,
  fenceFileContent,
  UNTRUSTED_BEGIN,
  UNTRUSTED_END,
  PROMPT_INJECTION_DEFENSE_PREAMBLE,
} from './fences.js';

test('wrapUntrusted: wraps with markers and label', () => {
  const out = wrapUntrusted('test', 'hello world');
  assert.ok(out.startsWith(UNTRUSTED_BEGIN));
  assert.ok(out.includes('[test]'));
  assert.ok(out.includes('hello world'));
  assert.ok(out.endsWith(UNTRUSTED_END));
});

test('wrapUntrusted: returns empty string for empty content', () => {
  assert.equal(wrapUntrusted('test', ''), '');
});

test('wrapUntrustedMulti: joins items with newlines', () => {
  const out = wrapUntrustedMulti('files', ['a.ts', 'b.ts']);
  assert.ok(out.includes('a.ts\nb.ts'));
});

test('wrapUntrustedMulti: skips empty items and returns empty if all empty', () => {
  assert.equal(wrapUntrustedMulti('x', []), '');
  assert.equal(wrapUntrustedMulti('x', ['', '  ', '']), 'x'.length === 1 ? '' : wrapUntrustedMulti('x', ['a']));
});

test('fenceFileContent: labels with file path', () => {
  const out = fenceFileContent('src/index.ts', 'console.log(1)');
  assert.ok(out.includes('[file:src/index.ts]'));
  assert.ok(out.includes('console.log(1)'));
});

test('PROMPT_INJECTION_DEFENSE_PREAMBLE: warns about injection attempts', () => {
  assert.ok(PROMPT_INJECTION_DEFENSE_PREAMBLE.includes(UNTRUSTED_BEGIN));
  assert.ok(PROMPT_INJECTION_DEFENSE_PREAMBLE.includes(UNTRUSTED_END));
  assert.match(PROMPT_INJECTION_DEFENSE_PREAMBLE, /UNTRUSTED/i);
  assert.match(PROMPT_INJECTION_DEFENSE_PREAMBLE, /ignore/i);
});