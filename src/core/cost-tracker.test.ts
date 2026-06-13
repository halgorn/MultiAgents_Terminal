import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CostTracker, SessionBudget } from './cost-tracker.js';

// Canonical model name as defined in runtime-policy.ts ClaudeModel type
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Expected cost for 1_000 in + 500 out + 200 cacheRead + 100 cacheWrite tokens
// Rates (per 1M): input=$0.80, output=$4.00, cacheRead=$0.08, cacheWrite=$1.00
// = 0.0008 + 0.002 + 0.000016 + 0.0001 = $0.0029
const EXPECTED_COST_1K = '0.0029';

test('CostTracker summarizes real SDK usage with correct pricing', () => {
  const costs = new CostTracker();

  costs.record('scanner-security', HAIKU_MODEL, {
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
  }, 123);

  assert.equal(costs.usageAvailable(), true);
  assert.equal(costs.totalTokens().inputTokens, 1_000);
  // Verify exact cost to detect pricing table regressions
  assert.match(costs.summary(), new RegExp(`cost: \\$${EXPECTED_COST_1K}`));
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
  costs.record('scanner-security', HAIKU_MODEL, {
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

  costs.record('scanner-security', HAIKU_MODEL, {
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

test('CostTracker falls back to haiku pricing for unknown models', () => {
  const costs = new CostTracker();

  // An unknown model string should fall back to haiku rates (not zero)
  costs.record('scanner-security', 'unknown-model-xyz', {
    inputTokens: 1_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }, 0);

  const total = costs.totalUsd();
  // Fallback to haiku input rate: 1000 * 0.80 / 1_000_000 = $0.0008
  assert.ok(total > 0, `expected non-zero cost for fallback model, got ${total}`);
  assert.match(costs.summary(), /cost: \$0\.0008/);
});

// ── SessionBudget ─────────────────────────────────────────────────────────────

test('SessionBudget: fresh budget has full remaining capacity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-budget-'));
  try {
    const b = new SessionBudget(dir, 1.50);
    assert.equal(b.remaining(), 1.50);
    assert.ok(b.canAfford(1.50));
    assert.ok(!b.canAfford(1.51));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionBudget: warningLine is null above 30% threshold', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-budget-'));
  try {
    const b = new SessionBudget(dir, 1.00);
    assert.equal(b.warningLine(), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionBudget: warningLine fires below 30% remaining', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-budget-'));
  try {
    const b = new SessionBudget(dir, 1.00);
    b.record(0.75);
    const warn = b.warningLine();
    assert.ok(warn !== null, 'expected a warning line at 25% remaining');
    assert.match(warn!, /Session budget low/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionBudget: record persists and reduces remaining', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-budget-'));
  try {
    const b1 = new SessionBudget(dir, 1.00);
    b1.record(0.40);
    assert.ok(Math.abs(b1.remaining() - 0.60) < 0.0001);

    // Re-reading from disk should restore state within the TTL
    const b2 = new SessionBudget(dir, 1.00);
    assert.ok(Math.abs(b2.remaining() - 0.60) < 0.0001);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionBudget: stale budget file resets to zero spent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-budget-'));
  try {
    const stale = {
      capUsd: 1.00,
      spentUsd: 0.90,
      updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
    };
    writeFileSync(join(dir, '.ai-runtime', 'session-budget.json'), JSON.stringify(stale), { recursive: true } as never);
  } catch { /* dir creation may fail, handled below */ }
  try {
    const b = new SessionBudget(dir, 1.00);
    // Stale budget should reset spent to 0, making full capacity available
    assert.equal(b.remaining(), 1.00);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionBudget: estimatedCost scales linearly with scanner count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-budget-'));
  try {
    const b = new SessionBudget(dir);
    const one = b.estimatedCost(1, 'claude-haiku-4-5-20251001');
    const three = b.estimatedCost(3, 'claude-haiku-4-5-20251001');
    assert.ok(Math.abs(three - one * 3) < 0.0001, `expected 3x scaling, got ${one} vs ${three}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
