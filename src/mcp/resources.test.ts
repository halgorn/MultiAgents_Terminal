import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildResourceList } from './resources.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-res-'));
}

test('buildResourceList returns all expected resources', () => {
  const ctx = { cwd: '.', traceId: 't' };
  const list = buildResourceList(ctx);
  const uris = list.map((r) => r.uri);
  for (const expected of [
    'aion://project/context',
    'aion://docs/architecture',
    'aion://docs/recent-changes',
    'aion://docs/security',
    'aion://docs/performance',
    'aion://docs/test-coverage',
    'aion://docs/dependencies',
    'aion://docs/modules/{name}',
    'aion://health',
    'aion://observability/recent',
    'aion://observability/summary',
  ]) {
    assert.ok(uris.includes(expected), `missing ${expected}`);
  }
});

test('security resource is user-only', () => {
  const list = buildResourceList({ cwd: '.', traceId: 't' });
  const sec = list.find((r) => r.uri === 'aion://docs/security')!;
  assert.equal(sec.annotations.audience, 'user');
});

test('context resource has high priority', () => {
  const list = buildResourceList({ cwd: '.', traceId: 't' });
  const ctx = list.find((r) => r.uri === 'aion://project/context')!;
  assert.ok(ctx.annotations.priority >= 0.8);
});

test('module resource requires name param', async () => {
  const list = buildResourceList({ cwd: '.', traceId: 't' });
  const mod = list.find((r) => r.uri === 'aion://docs/modules/{name}')!;
  const result = await mod.handler({ cwd: '.', params: {} });
  assert.match(result.contents[0]?.text ?? '', /Missing/);
});

test('context resource returns helpful text when no PIL', async () => {
  const cwd = makeTmp();
  try {
    const list = buildResourceList({ cwd, traceId: 't' });
    const ctx = list.find((r) => r.uri === 'aion://project/context')!;
    const result = await ctx.handler({ cwd, params: {} });
    assert.match(result.contents[0]?.text ?? '', /No PIL/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('health resource returns JSON with required fields', async () => {
  const cwd = makeTmp();
  try {
    const list = buildResourceList({ cwd, traceId: 't' });
    const h = list.find((r) => r.uri === 'aion://health')!;
    const result = await h.handler({ cwd, params: {} });
    const parsed = JSON.parse(result.contents[0]?.text ?? '{}');
    assert.equal(parsed.pilExists, false);
    assert.equal(parsed.confidence, 'stale');
    assert.ok('summary' in parsed);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('all resources have annotations', () => {
  const list = buildResourceList({ cwd: '.', traceId: 't' });
  for (const r of list) {
    assert.ok(r.annotations, `missing annotations for ${r.uri}`);
    assert.ok(['user', 'assistant', 'both'].includes(r.annotations.audience));
    assert.ok(r.annotations.priority >= 0 && r.annotations.priority <= 1);
    assert.ok(['realtime', 'sync', 'lazy'].includes(r.annotations.freshness));
  }
});

test('every resource has a handler', () => {
  const list = buildResourceList({ cwd: '.', traceId: 't' });
  for (const r of list) {
    assert.equal(typeof r.handler, 'function', `${r.uri} has no handler`);
  }
});

test('all resource URIs start with aion://', () => {
  const list = buildResourceList({ cwd: '.', traceId: 't' });
  for (const r of list) {
    assert.ok(r.uri.startsWith('aion://'), `${r.uri} doesn't start with aion://`);
  }
});

test('observability summary resource returns object', async () => {
  const cwd = makeTmp();
  try {
    const list = buildResourceList({ cwd, traceId: 't' });
    const r = list.find((res) => res.uri === 'aion://observability/summary')!;
    const result = await r.handler({ cwd, params: {} });
    const parsed = JSON.parse(result.contents[0]?.text ?? '{}');
    assert.equal(parsed.total, 0);
    assert.equal(parsed.errors, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
