import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CAPABILITIES,
  mergeCapabilities,
  type TokenUsage,
  type ProviderCapabilities,
} from './types.js';

test('DEFAULT_CAPABILITIES: conservative defaults', () => {
  const c = DEFAULT_CAPABILITIES;
  assert.equal(c.hasToolAccess, false);
  assert.equal(c.hasFileAccess, false);
  assert.equal(c.supportsJsonSchema, false);
  assert.equal(c.supportsEmbeddings, false);
  assert.equal(c.maxContextTokens, 8000);
});

test('mergeCapabilities: override individual fields', () => {
  const merged = mergeCapabilities(DEFAULT_CAPABILITIES, { hasToolAccess: true, maxContextTokens: 200000 });
  assert.equal(merged.hasToolAccess, true);
  assert.equal(merged.maxContextTokens, 200000);
  assert.equal(merged.hasFileAccess, false, 'untouched fields keep base value');
});

test('mergeCapabilities: empty override returns equivalent capabilities', () => {
  const merged = mergeCapabilities(DEFAULT_CAPABILITIES, {});
  assert.deepEqual(merged, DEFAULT_CAPABILITIES);
});

test('TokenUsage: shape validation', () => {
  const u: TokenUsage = {
    agentName: 'planner',
    provider: 'claude',
    inputTokens: 1500,
    outputTokens: 800,
    totalTokens: 2300,
    model: 'claude-sonnet-4-6',
    costUsd: 0.012,
    timestamp: new Date().toISOString(),
  };
  assert.equal(u.inputTokens + u.outputTokens, u.totalTokens);
  assert.match(u.timestamp, /^\d{4}-\d{2}-\d{2}/);
});

test('ProviderCapabilities: required fields', () => {
  const c: ProviderCapabilities = {
    hasToolAccess: true,
    hasFileAccess: false,
    supportsJsonSchema: true,
    supportsEmbeddings: false,
    maxContextTokens: 200000,
  };
  assert.equal(c.hasToolAccess, true);
  assert.equal(c.maxContextTokens, 200000);
});