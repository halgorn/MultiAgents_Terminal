import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import {
  DEFAULT_POLICY,
  readPolicy,
  writePolicy,
  matchesDenyList,
  recordUsage,
  readUsageThisMonth,
  summarizeUsage,
  estimateCost,
  mergeWithDefaults,
  type Policy,
  type UsageRecord,
  type DenyListRule,
} from './policy.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-pol-'));
}

function writeFile(p: string, content: string): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

test('readPolicy returns defaults when no .aionrc.json', () => {
  const cwd = makeTmp();
  try {
    const p = readPolicy(cwd);
    assert.equal(p.budget.monthlyUsd, 50);
    assert.equal(p.denyList.length > 0, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readPolicy returns defaults on corrupted JSON', () => {
  const cwd = makeTmp();
  try {
    writeFile(join(cwd, '.aionrc.json'), '{ broken');
    const p = readPolicy(cwd);
    assert.equal(p.budget.monthlyUsd, 50);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readPolicy merges partial config with defaults', () => {
  const cwd = makeTmp();
  try {
    writeFile(join(cwd, '.aionrc.json'), JSON.stringify({
      policy: { budget: { monthlyUsd: 100, perRequestUsd: 2, warnAtPct: 90 } },
    }));
    const p = readPolicy(cwd);
    assert.equal(p.budget.monthlyUsd, 100);
    assert.equal(p.budget.perRequestUsd, 2);
    assert.equal(p.budget.warnAtPct, 90);
    assert.ok(p.denyList.length > 0, 'should still have default denyList');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readPolicy fills missing budget fields from defaults', () => {
  const cwd = makeTmp();
  try {
    writeFile(join(cwd, '.aionrc.json'), JSON.stringify({
      policy: { budget: { monthlyUsd: 100 } },
    }));
    const p = readPolicy(cwd);
    assert.equal(p.budget.monthlyUsd, 100);
    assert.equal(p.budget.perRequestUsd, DEFAULT_POLICY.budget.perRequestUsd);
    assert.equal(p.budget.warnAtPct, DEFAULT_POLICY.budget.warnAtPct);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('writePolicy + readPolicy roundtrip', () => {
  const cwd = makeTmp();
  try {
    const policy: Policy = {
      budget: { monthlyUsd: 200, perRequestUsd: 0.5, warnAtPct: 75 },
      denyList: [{ pattern: '**/foo/**', reason: 'test', audience: 'both' }],
      defaultModel: 'gpt-4',
      fallbackModel: 'gpt-4o-mini',
      updatedAt: '2026-06-18T00:00:00Z',
    };
    writePolicy(cwd, policy);
    const loaded = readPolicy(cwd);
    assert.equal(loaded.budget.monthlyUsd, 200);
    assert.equal(loaded.denyList[0]?.pattern, '**/foo/**');
    assert.equal(loaded.defaultModel, 'gpt-4');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('writePolicy preserves other .aionrc.json keys', () => {
  const cwd = makeTmp();
  try {
    writeFile(join(cwd, '.aionrc.json'), JSON.stringify({ provider: 'claude', other: 'value' }));
    writePolicy(cwd, { ...DEFAULT_POLICY, budget: { ...DEFAULT_POLICY.budget, monthlyUsd: 999 } });
    const raw = JSON.parse(readFileSync(join(cwd, '.aionrc.json'), 'utf8'));
    assert.equal(raw.provider, 'claude');
    assert.equal(raw.other, 'value');
    assert.equal(raw.policy.budget.monthlyUsd, 999);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('matchesDenyList returns null for non-matching path', () => {
  const rules: DenyListRule[] = [{ pattern: '**/secrets/**', reason: 'x', audience: 'both' }];
  assert.equal(matchesDenyList('src/foo.ts', rules), null);
});

test('matchesDenyList returns rule for matching path', () => {
  const rules: DenyListRule[] = [{ pattern: '**/secrets/**', reason: 'x', audience: 'both' }];
  const match = matchesDenyList('src/secrets/key.ts', rules);
  assert.ok(match);
  assert.equal(match?.reason, 'x');
});

test('matchesDenyList handles * (single level)', () => {
  const rules: DenyListRule[] = [{ pattern: 'src/*.ts', reason: 'x', audience: 'both' }];
  assert.ok(matchesDenyList('src/foo.ts', rules));
  assert.equal(matchesDenyList('src/nested/foo.ts', rules), null);
});

test('matchesDenyList handles ** (multi level)', () => {
  const rules: DenyListRule[] = [{ pattern: '**/*.key', reason: 'x', audience: 'both' }];
  assert.equal(matchesDenyList('a/b/c.pem', rules), null);
  assert.ok(matchesDenyList('deep/nested/path/server.key', rules));
});

test('matchesDenyList handles ?', () => {
  const rules: DenyListRule[] = [{ pattern: 'src/?.ts', reason: 'x', audience: 'both' }];
  assert.ok(matchesDenyList('src/a.ts', rules));
  assert.equal(matchesDenyList('src/ab.ts', rules), null);
});

test('matchesDenyList returns first match', () => {
  const rules: DenyListRule[] = [
    { pattern: '**/a/**', reason: 'first', audience: 'both' },
    { pattern: '**/b/**', reason: 'second', audience: 'both' },
  ];
  const match = matchesDenyList('src/a/b.ts', rules);
  assert.equal(match?.reason, 'first');
});

test('recordUsage appends to usage.jsonl', () => {
  const cwd = makeTmp();
  try {
    const record: UsageRecord = {
      ts: new Date().toISOString(),
      tool: 'search_memory',
      estTokens: 500,
      estimatedCostUsd: 0.01,
      model: 'claude',
      traceId: 'abc',
    };
    recordUsage(cwd, record);
    const records = readUsageThisMonth(cwd);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.tool, 'search_memory');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readUsageThisMonth filters by current month', () => {
  const cwd = makeTmp();
  try {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    recordUsage(cwd, { ts: lastMonth.toISOString(), estTokens: 100, estimatedCostUsd: 0.001, model: 'claude', traceId: 'old' });
    recordUsage(cwd, { ts: new Date().toISOString(), estTokens: 200, estimatedCostUsd: 0.002, model: 'claude', traceId: 'new' });
    const records = readUsageThisMonth(cwd);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.traceId, 'new');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('summarizeUsage computes total cost and budget pct', () => {
  const cwd = makeTmp();
  try {
    writePolicy(cwd, { ...DEFAULT_POLICY, budget: { ...DEFAULT_POLICY.budget, monthlyUsd: 10, warnAtPct: 80 } });
    const policy = readPolicy(cwd);
    recordUsage(cwd, { ts: new Date().toISOString(), estTokens: 100, estimatedCostUsd: 8, model: 'claude', traceId: 't' });
    const summary = summarizeUsage(cwd, policy);
    assert.equal(summary.totalCostUsd, 8);
    assert.equal(summary.budgetUsd, 10);
    assert.equal(summary.budgetUsedPct, 80);
    assert.equal(summary.nearBudget, true);
    assert.equal(summary.overBudget, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('summarizeUsage detects over budget', () => {
  const cwd = makeTmp();
  try {
    writePolicy(cwd, { ...DEFAULT_POLICY, budget: { ...DEFAULT_POLICY.budget, monthlyUsd: 5 } });
    const policy = readPolicy(cwd);
    recordUsage(cwd, { ts: new Date().toISOString(), estTokens: 100, estimatedCostUsd: 7, model: 'claude', traceId: 't' });
    const summary = summarizeUsage(cwd, policy);
    assert.equal(summary.overBudget, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('estimateCost returns 0 for zero tokens', () => {
  assert.equal(estimateCost('claude', 0), 0);
});

test('estimateCost uses model-specific rate', () => {
  const claude = estimateCost('claude', 1000);
  const haiku = estimateCost('claude-haiku', 1000);
  assert.ok(claude > haiku, 'claude should cost more than haiku');
  assert.equal(haiku, 0.0008);
});

test('estimateCost uses default rate for unknown model', () => {
  const cost = estimateCost('unknown-model', 1000);
  assert.equal(cost, 0.002);
});

test('mergeWithDefaults fills missing fields', () => {
  const partial: Partial<Policy> = { budget: { monthlyUsd: 999, perRequestUsd: 1, warnAtPct: 80 } };
  const merged = mergeWithDefaults(partial);
  assert.equal(merged.budget.monthlyUsd, 999);
  assert.ok(merged.denyList.length > 0);
  assert.ok(merged.defaultModel);
});

test('DEFAULT_POLICY has all required fields', () => {
  assert.ok(DEFAULT_POLICY.budget);
  assert.ok(DEFAULT_POLICY.denyList);
  assert.ok(DEFAULT_POLICY.defaultModel);
  assert.ok(DEFAULT_POLICY.fallbackModel);
});
