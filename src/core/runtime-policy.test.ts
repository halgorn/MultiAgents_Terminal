import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimePolicy, limitChars, limitLines } from './runtime-policy.js';

test('low budget is economical by default', () => {
  const policy = createRuntimePolicy();

  assert.equal(policy.budget, 'low');
  assert.equal(policy.deep, false);
  assert.equal(policy.maxAgents, 3);
  assert.equal(policy.maxFileLines, 500);
  assert.equal(policy.plannerProvider, 'claude');
  assert.equal(policy.investigatorProvider, 'codex');
  assert.equal(policy.developerProvider, 'codex');
  assert.equal(policy.reviewerProvider, 'claude');
});

test('deep budget enables multi-investigator fan out', () => {
  const policy = createRuntimePolicy({ budget: 'deep' });

  assert.equal(policy.deep, true);
  assert.equal(policy.maxAgents, 7);
});

test('limitLines truncates over-budget text', () => {
  const text = ['a', 'b', 'c'].join('\n');

  assert.equal(limitLines(text, 2), 'a\nb\n[truncated: 1 lines omitted]');
});

test('limitChars truncates over-budget text', () => {
  assert.equal(limitChars('abcdef', 3), 'abc\n[truncated: 3 chars omitted]');
});
