import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeConfidence,
  shouldResync,
  buildResponseMeta,
  buildResponseMetaWithFiles,
  formatConfidence,
} from './freshness.js';
import { DEFAULT_FRESHNESS } from './types.js';

const NOW = new Date('2026-06-18T12:00:00Z');

test('computeConfidence returns "high" with 0 changes and fresh', () => {
  const c = computeConfidence(
    { indexedAt: '2026-06-18T11:55:00Z', filesChangedSince: 0, filesTotal: 100 },
    DEFAULT_FRESHNESS,
    NOW,
  );
  assert.equal(c, 'high');
});

test('computeConfidence returns "medium" with 1-2 changes and <30min', () => {
  const c = computeConfidence(
    { indexedAt: '2026-06-18T11:50:00Z', filesChangedSince: 1, filesTotal: 100 },
    DEFAULT_FRESHNESS,
    NOW,
  );
  assert.equal(c, 'medium');
});

test('computeConfidence returns "medium" with 0 changes but 10min old', () => {
  const c = computeConfidence(
    { indexedAt: '2026-06-18T11:50:00Z', filesChangedSince: 0, filesTotal: 100 },
    DEFAULT_FRESHNESS,
    NOW,
  );
  assert.equal(c, 'medium');
});

test('computeConfidence returns "stale" with 3+ changes', () => {
  const c = computeConfidence(
    { indexedAt: '2026-06-18T11:59:00Z', filesChangedSince: 3, filesTotal: 100 },
    DEFAULT_FRESHNESS,
    NOW,
  );
  assert.equal(c, 'stale');
});

test('computeConfidence returns "stale" with >30min age', () => {
  const c = computeConfidence(
    { indexedAt: '2026-06-18T11:00:00Z', filesChangedSince: 0, filesTotal: 100 },
    DEFAULT_FRESHNESS,
    NOW,
  );
  assert.equal(c, 'stale');
});

test('shouldResync is true only for "stale"', () => {
  assert.equal(shouldResync({ indexedAt: '2026-06-18T11:55:00Z', filesChangedSince: 0, filesTotal: 100 }, DEFAULT_FRESHNESS, NOW), false);
  assert.equal(shouldResync({ indexedAt: '2026-06-18T11:50:00Z', filesChangedSince: 1, filesTotal: 100 }, DEFAULT_FRESHNESS, NOW), false);
  assert.equal(shouldResync({ indexedAt: '2026-06-18T11:00:00Z', filesChangedSince: 0, filesTotal: 100 }, DEFAULT_FRESHNESS, NOW), true);
  assert.equal(shouldResync({ indexedAt: '2026-06-18T11:59:00Z', filesChangedSince: 3, filesTotal: 100 }, DEFAULT_FRESHNESS, NOW), true);
});

test('computeConfidence respects custom config', () => {
  const c = computeConfidence(
    { indexedAt: '2026-06-18T11:00:00Z', filesChangedSince: 0, filesTotal: 100 },
    { highMaxChanged: 0, staleMinChanged: 100, staleAgeSec: 86400 },
    NOW,
  );
  assert.equal(c, 'high');
});

test('computeConfidence handles future-dated indexedAt', () => {
  const c = computeConfidence(
    { indexedAt: '2026-06-18T13:00:00Z', filesChangedSince: 0, filesTotal: 100 },
    DEFAULT_FRESHNESS,
    NOW,
  );
  assert.equal(c, 'high');
});

test('buildResponseMeta uses epoch when no PIL', () => {
  const meta = buildResponseMeta({ cwd: '/nonexistent', traceId: 'abc', estTokens: 100 });
  assert.equal(meta.pilVersion, 1);
  assert.equal(meta.confidence, 'stale');
  assert.equal(meta.syncRecommended, true);
  assert.equal(meta.traceId, 'abc');
  assert.equal(meta.estTokens, 100);
});

test('buildResponseMetaWithFiles includes filesChangedSince', () => {
  const meta = buildResponseMetaWithFiles({ cwd: '/nonexistent', traceId: 'abc', estTokens: 100 }, 5);
  assert.equal(meta.filesChangedSince, 5);
  assert.equal(meta.confidence, 'stale');
});

test('buildResponseMeta includes tool/resource names', () => {
  const meta = buildResponseMeta({ cwd: '/nonexistent', tool: 't', resource: 'r', traceId: 'abc', estTokens: 100 });
  assert.equal(meta.tool, 't');
  assert.equal(meta.resource, 'r');
});

test('formatConfidence returns emoji-prefixed label', () => {
  assert.match(formatConfidence('high'), /high/);
  assert.match(formatConfidence('medium'), /medium/);
  assert.match(formatConfidence('stale'), /stale/);
});

test('confidence boundaries: ageSec just under staleAgeSec/4 = high', () => {
  const c = computeConfidence(
    { indexedAt: '2026-06-18T11:55:01Z', filesChangedSince: 0, filesTotal: 100 },
    DEFAULT_FRESHNESS,
    NOW,
  );
  assert.equal(c, 'high');
});

test('confidence boundaries: ageSec just over staleAgeSec/4 = medium', () => {
  const c = computeConfidence(
    { indexedAt: '2026-06-18T11:50:00Z', filesChangedSince: 0, filesTotal: 100 },
    DEFAULT_FRESHNESS,
    NOW,
  );
  assert.equal(c, 'medium');
});

test('negative age (clock skew) treated as fresh', () => {
  const c = computeConfidence(
    { indexedAt: '2026-06-18T13:00:00Z', filesChangedSince: 0, filesTotal: 100 },
    DEFAULT_FRESHNESS,
    NOW,
  );
  assert.equal(c, 'high');
});
