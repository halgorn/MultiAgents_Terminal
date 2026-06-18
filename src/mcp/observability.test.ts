import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withObservability, recentEntries, observabilitySummary, clearObservability, RING_SIZE } from './observability.js';

test('withObservability captures success', async () => {
  clearObservability();
  const { result, entry, meta } = await withObservability({ tool: 't1' }, async () => ({ meta: { estTokens: 100 } }));
  assert.ok(result);
  assert.equal(entry.status, 'ok');
  assert.equal(entry.tool, 't1');
  assert.equal(entry.traceId.length > 0, true);
  assert.equal(entry.durationMs >= 0, true);
  assert.equal(meta.estTokens, 100);
});

test('withObservability captures error', async () => {
  clearObservability();
  await assert.rejects(
    withObservability({ tool: 't2' }, async () => { throw new Error('boom'); }),
    /boom/,
  );
  const entries = recentEntries();
  const t2 = entries.find((e) => e.tool === 't2');
  assert.ok(t2);
  assert.equal(t2.status, 'error');
  assert.match(t2.error ?? '', /boom/);
});

test('withObservability generates unique trace IDs', async () => {
  clearObservability();
  const ids = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const { entry } = await withObservability({ tool: `t-${i}` }, async () => ({}));
    ids.add(entry.traceId);
  }
  assert.equal(ids.size, 10);
});

test('withObservability measures duration', async () => {
  clearObservability();
  const { entry } = await withObservability({ tool: 'slow' }, async () => {
    await new Promise((r) => setTimeout(r, 30));
    return {};
  });
  assert.ok(entry.durationMs >= 25, `expected ≥25ms, got ${entry.durationMs}`);
});

test('recentEntries returns in order', async () => {
  clearObservability();
  for (let i = 0; i < 5; i++) {
    await withObservability({ tool: `t-${i}` }, async () => ({}));
  }
  const recent = recentEntries();
  assert.equal(recent.length, 5);
  assert.equal(recent[0]?.tool, 't-0');
  assert.equal(recent[4]?.tool, 't-4');
});

test('recentEntries respects limit', async () => {
  clearObservability();
  for (let i = 0; i < 20; i++) {
    await withObservability({ tool: `t-${i}` }, async () => ({}));
  }
  const recent = recentEntries(5);
  assert.equal(recent.length, 5);
});

test('ring buffer wraps at RING_SIZE', async () => {
  clearObservability();
  for (let i = 0; i < RING_SIZE + 10; i++) {
    await withObservability({ tool: `t-${i}` }, async () => ({}));
  }
  const recent = recentEntries();
  assert.ok(recent.length <= RING_SIZE);
});

test('observabilitySummary aggregates correctly', async () => {
  clearObservability();
  for (let i = 0; i < 10; i++) {
    try {
      await withObservability({ tool: `ok-${i}` }, async () => ({}));
    } catch { /* ignore */ }
  }
  await assert.rejects(withObservability({ tool: 'err' }, async () => { throw new Error('x'); })).catch(() => {});
  const summary = observabilitySummary();
  assert.ok(summary.total > 0);
  assert.ok(summary.errors >= 1);
  assert.ok(summary.avgDurationMs >= 0);
});

test('observabilitySummary is empty initially', () => {
  clearObservability();
  const summary = observabilitySummary();
  assert.equal(summary.total, 0);
  assert.equal(summary.errors, 0);
  assert.equal(summary.totalTokens, 0);
  assert.equal(summary.p50, 0);
  assert.equal(summary.p95, 0);
});

test('withObservability captures resource calls', async () => {
  clearObservability();
  const { entry } = await withObservability({ resource: 'aion://x' }, async () => ({}));
  assert.equal(entry.resource, 'aion://x');
  assert.equal(entry.tool, undefined);
});

test('withObservability captures args', async () => {
  clearObservability();
  const { entry } = await withObservability({ tool: 't', args: { q: 'auth' } }, async () => ({}));
  assert.deepEqual(entry.args, { q: 'auth' });
});

test('clearObservability empties the buffer', async () => {
  await withObservability({ tool: 't' }, async () => ({}));
  clearObservability();
  assert.equal(recentEntries().length, 0);
});

test('summary p50/p95 are computed from sorted durations', async () => {
  clearObservability();
  for (let i = 0; i < 20; i++) {
    await withObservability({ tool: `t-${i}` }, async () => {
      await new Promise((r) => setTimeout(r, i));
      return {};
    });
  }
  const summary = observabilitySummary();
  assert.ok(summary.p50 >= 0);
  assert.ok(summary.p95 >= summary.p50);
});
