import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Tracer, loadTraces, formatDuration } from './tracer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'tracer-'));
}

const TOKENS = { input: 1000, output: 500, cache: 200 };

// ── Tracer: startSpan / endSpan ───────────────────────────────────────────────

test('Tracer: startSpan + endSpan records span with ok status', () => {
  const dir = makeDir();
  try {
    const tracer = new Tracer('audit');
    tracer.startSpan('scanner');
    tracer.endSpan('scanner', 'claude-haiku-4-5-20251001', TOKENS, 0.002);
    tracer.flush(dir, 'claude-haiku-4-5-20251001');

    const traces = loadTraces(dir);
    assert.equal(traces.length, 1);
    const span = traces[0]!.spans.find((s) => s.agent === 'scanner');
    assert.ok(span, 'scanner span should exist');
    assert.equal(span!.status, 'ok');
    assert.equal(span!.model, 'claude-haiku-4-5-20251001');
    assert.equal(span!.inputTokens, 1000);
    assert.equal(span!.outputTokens, 500);
    assert.ok(span!.durationMs >= 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tracer: endSpan with error sets status to error', () => {
  const dir = makeDir();
  try {
    const tracer = new Tracer('audit');
    tracer.startSpan('scanner');
    tracer.endSpan('scanner', 'claude-haiku-4-5-20251001', TOKENS, 0, 'context limit exceeded');
    tracer.flush(dir);

    const traces = loadTraces(dir);
    const span = traces[0]!.spans[0]!;
    assert.equal(span.status, 'error');
    assert.equal(span.error, 'context limit exceeded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tracer: endSpan without matching startSpan is a no-op', () => {
  const dir = makeDir();
  try {
    const tracer = new Tracer('audit');
    assert.doesNotThrow(() => tracer.endSpan('ghost-agent', 'model', TOKENS, 0));
    tracer.flush(dir);
    const traces = loadTraces(dir);
    assert.equal(traces.length, 0, 'no spans should be written when none were started');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tracer: multiple spans in one trace', () => {
  const dir = makeDir();
  try {
    const tracer = new Tracer('audit');
    tracer.startSpan('scanner');
    tracer.endSpan('scanner', 'model', TOKENS, 0.001);
    tracer.startSpan('synthesizer');
    tracer.endSpan('synthesizer', 'model', TOKENS, 0.002);
    tracer.flush(dir);

    const traces = loadTraces(dir);
    assert.equal(traces[0]!.spans.length, 2);
    assert.equal(traces[0]!.totalCostUsd, 0.003);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tracer: flushPending closes open spans with zero tokens', () => {
  const dir = makeDir();
  try {
    const tracer = new Tracer('audit');
    tracer.startSpan('scanner');
    tracer.flushPending('model');
    tracer.flush(dir);

    const traces = loadTraces(dir);
    const span = traces[0]!.spans[0]!;
    assert.equal(span.agent, 'scanner');
    assert.equal(span.inputTokens, 0);
    assert.equal(span.outputTokens, 0);
    assert.equal(span.status, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Tracer: flush no-ops when no spans collected', () => {
  const dir = makeDir();
  try {
    const tracer = new Tracer('audit');
    tracer.flush(dir);
    const traces = loadTraces(dir);
    assert.equal(traces.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── loadTraces ────────────────────────────────────────────────────────────────

test('loadTraces: returns empty array when no traces file', () => {
  const dir = makeDir();
  try {
    assert.deepEqual(loadTraces(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTraces: respects limit and returns most recent first', () => {
  const dir = makeDir();
  try {
    for (let i = 0; i < 5; i++) {
      const t = new Tracer(`cmd-${i}`);
      t.startSpan('agent');
      t.endSpan('agent', 'model', TOKENS, 0);
      t.flush(dir);
    }
    const traces = loadTraces(dir, 3);
    assert.equal(traces.length, 3);
    // Most recent first — last written command is cmd-4
    assert.equal(traces[0]!.command, 'cmd-4');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── formatDuration ────────────────────────────────────────────────────────────

test('formatDuration: milliseconds for < 1s', () => {
  assert.equal(formatDuration(500), '500ms');
});

test('formatDuration: seconds with one decimal for < 1min', () => {
  assert.equal(formatDuration(3500), '3.5s');
});

test('formatDuration: minutes and seconds for >= 1min', () => {
  assert.equal(formatDuration(90000), '1m30s');
});
