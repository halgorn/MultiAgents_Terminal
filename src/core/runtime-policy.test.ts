import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimePolicy, limitChars, limitLines, PROVIDER_NAMES, BUDGET_NAMES, DEFAULT_MODELS } from './runtime-policy.js';

test('low budget is economical by default', () => {
  const policy = createRuntimePolicy();

  assert.equal(policy.budget, 'low');
  assert.equal(policy.deep, false);
  assert.equal(policy.maxAgents, 1);
  assert.equal(policy.maxFileLines, 500);
  assert.equal(policy.plannerProvider, 'claude');
  assert.equal(policy.investigatorProvider, 'claude');
  assert.equal(policy.developerProvider, 'claude');
  assert.equal(policy.reviewerProvider, 'claude');
});

test('deep budget enables multi-investigator fan out', () => {
  const policy = createRuntimePolicy({ budget: 'deep' });

  assert.equal(policy.deep, true);
  assert.equal(policy.maxAgents, 7);
});

test('normal budget caps fan-out to two scanners', () => {
  const policy = createRuntimePolicy({ budget: 'normal' });
  assert.equal(policy.maxAgents, 2);
});

test('limitLines truncates over-budget text', () => {
  const text = ['a', 'b', 'c'].join('\n');

  assert.equal(limitLines(text, 2), 'a\nb\n[truncated: 1 lines omitted]');
});

test('limitChars truncates over-budget text', () => {
  assert.equal(limitChars('abcdef', 3), 'abc\n[truncated: 3 chars omitted]');
});

test('PROVIDER_NAMES includes all 5 providers', () => {
  assert.ok(PROVIDER_NAMES.includes('claude'));
  assert.ok(PROVIDER_NAMES.includes('codex'));
  assert.ok(PROVIDER_NAMES.includes('openrouter'));
  assert.ok(PROVIDER_NAMES.includes('kimi'));
  assert.ok(PROVIDER_NAMES.includes('minimax'));
  assert.equal(PROVIDER_NAMES.length, 5);
});

test('BUDGET_NAMES has exactly low/normal/deep', () => {
  assert.deepEqual([...BUDGET_NAMES], ['low', 'normal', 'deep']);
});

test('DEFAULT_MODELS has entries for non-claude providers', () => {
  assert.ok(typeof DEFAULT_MODELS.codex === 'string' && DEFAULT_MODELS.codex.length > 0);
  assert.ok(typeof DEFAULT_MODELS.openrouter === 'string' && DEFAULT_MODELS.openrouter.length > 0);
  assert.ok(typeof DEFAULT_MODELS.kimi === 'string' && DEFAULT_MODELS.kimi.length > 0);
  assert.ok(typeof DEFAULT_MODELS.minimax === 'string' && DEFAULT_MODELS.minimax.length > 0);
});

test('createRuntimePolicy respects provider overrides', () => {
  const policy = createRuntimePolicy({ plannerProvider: 'openrouter' });
  assert.equal(policy.plannerProvider, 'openrouter');
  assert.equal(policy.developerProvider, 'claude');
});
