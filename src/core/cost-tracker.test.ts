import test from 'node:test';
import assert from 'node:assert/strict';
import { CostTracker } from './cost-tracker.js';

test('CostTracker summarizes real SDK usage', () => {
  const costs = new CostTracker();

  costs.record('scanner-security', 'claude-haiku-4-5', {
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
  }, 123);

  assert.equal(costs.usageAvailable(), true);
  assert.equal(costs.totalTokens().inputTokens, 1_000);
  assert.match(costs.summary(), /cost: \$0\.00/);
  assert.match(costs.summary(), /tokens: 1000in 500out/);
});

test('CostTracker reports unavailable usage for CLI providers', () => {
  const costs = new CostTracker();

  costs.recordUnavailable('scanner-security');

  assert.equal(costs.usageAvailable(), false);
  assert.match(costs.summary(), /cost: unavailable/);
  assert.match(costs.summary(), /usage unavailable: scanner-security/);
});

test('real usage clears unavailable marker for the same agent', () => {
  const costs = new CostTracker();

  costs.recordUnavailable('scanner-security');
  costs.record('scanner-security', 'claude-haiku-4-5', {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }, 1);

  assert.equal(costs.usageAvailable(), true);
  assert.doesNotMatch(costs.summary(), /usage unavailable/);
});

test('mixed real and unavailable usage remains unavailable', () => {
  const costs = new CostTracker();

  costs.record('scanner-security', 'claude-haiku-4-5', {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }, 1);
  costs.recordUnavailable('scanner-bugs');

  assert.equal(costs.usageAvailable(), false);
  assert.match(costs.summary(), /cost: unavailable/);
  assert.match(costs.summary(), /usage unavailable: scanner-bugs/);
});
