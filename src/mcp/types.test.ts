import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FRESHNESS,
  DEFAULT_MCP_OPTIONS,
  clampPriority,
  defaultMcpOptions,
  estimateTokens,
  resolveAudience,
  resolveFreshness,
  type Confidence,
  type FreshnessConfig,
  type McpResponseMeta,
} from './types.js';

test('DEFAULT_FRESHNESS has conservative defaults', () => {
  assert.equal(DEFAULT_FRESHNESS.highMaxChanged, 0);
  assert.equal(DEFAULT_FRESHNESS.staleMinChanged, 3);
  assert.equal(DEFAULT_FRESHNESS.staleAgeSec, 1800);
});

test('DEFAULT_MCP_OPTIONS has all keys', () => {
  const keys = Object.keys(DEFAULT_MCP_OPTIONS);
  for (const k of ['cwd', 'autoSync', 'watch', 'tokenBudget', 'logFile', 'logLevel', 'freshness', 'autoResync', 'allowedRoots']) {
    assert.ok(keys.includes(k), `missing key ${k}`);
  }
});

test('defaultMcpOptions merges overrides', () => {
  const o = defaultMcpOptions({ tokenBudget: 4000, autoSync: false });
  assert.equal(o.tokenBudget, 4000);
  assert.equal(o.autoSync, false);
  assert.equal(o.watch, true);
});

test('defaultMcpOptions returns defaults when empty', () => {
  const o = defaultMcpOptions();
  assert.equal(o.tokenBudget, 1500);
  assert.equal(o.autoSync, true);
  assert.equal(o.autoResync, true);
});

test('resolveAudience maps valid values', () => {
  assert.equal(resolveAudience('user'), 'user');
  assert.equal(resolveAudience('assistant'), 'assistant');
  assert.equal(resolveAudience('both'), 'both');
});

test('resolveAudience defaults to "both" on invalid', () => {
  assert.equal(resolveAudience(''), 'both');
  assert.equal(resolveAudience('garbage'), 'both');
  assert.equal(resolveAudience(undefined), 'both');
});

test('resolveFreshness maps valid values', () => {
  assert.equal(resolveFreshness('realtime'), 'realtime');
  assert.equal(resolveFreshness('sync'), 'sync');
  assert.equal(resolveFreshness('lazy'), 'lazy');
});

test('resolveFreshness defaults to "sync" on invalid', () => {
  assert.equal(resolveFreshness(''), 'sync');
  assert.equal(resolveFreshness('garbage'), 'sync');
  assert.equal(resolveFreshness(undefined), 'sync');
});

test('clampPriority bounds to [0, 1]', () => {
  assert.equal(clampPriority(0.5), 0.5);
  assert.equal(clampPriority(-0.5), 0);
  assert.equal(clampPriority(1.5), 1);
  assert.equal(clampPriority(0), 0);
  assert.equal(clampPriority(1), 1);
});

test('clampPriority handles NaN', () => {
  assert.equal(clampPriority(Number.NaN), 0);
});

test('estimateTokens divides by 4 and rounds up', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('a'), 1);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateTokens('a'.repeat(400)), 100);
  assert.equal(estimateTokens('a'.repeat(401)), 101);
});

test('Confidence type accepts 3 values', () => {
  const c: Confidence[] = ['high', 'medium', 'stale'];
  assert.equal(c.length, 3);
});

test('FreshnessConfig typecheck', () => {
  const c: FreshnessConfig = { highMaxChanged: 0, staleMinChanged: 5, staleAgeSec: 60 };
  assert.equal(c.staleMinChanged, 5);
});

test('McpResponseMeta has all required fields', () => {
  const m: McpResponseMeta = {
    pilVersion: 1,
    indexedAt: '2026-06-18T12:00:00Z',
    filesTotal: 100,
    filesChangedSince: 0,
    confidence: 'high',
    syncRecommended: false,
    estTokens: 50,
    traceId: 'abc',
  };
  assert.equal(m.confidence, 'high');
  assert.equal(m.pilVersion, 1);
});
