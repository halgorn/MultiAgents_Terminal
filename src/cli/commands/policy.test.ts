import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  renderPolicy,
  setBudget,
  addDenyRule,
  removeDenyRule,
  checkDenyList,
  recordToolUsage,
} from './policy.js';
import { readPolicy, writePolicy, DEFAULT_POLICY } from '../../infra/policy.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-polcli-'));
}

test('renderPolicy includes all sections', () => {
  const md = renderPolicy(DEFAULT_POLICY);
  assert.match(md, /# Policy/);
  assert.match(md, /## Budget/);
  assert.match(md, /## Models/);
  assert.match(md, /## Deny list/);
});

test('renderPolicy with usage shows usage section', () => {
  const summary = {
    month: '2026-06',
    totalTokens: 1000,
    totalCostUsd: 0.5,
    requestCount: 5,
    budgetUsd: 10,
    budgetUsedPct: 5,
    overBudget: false,
    nearBudget: false,
  };
  const md = renderPolicy(DEFAULT_POLICY, summary);
  assert.match(md, /## Usage this month/);
  assert.match(md, /Tokens: 1,000/);
  assert.match(md, /Cost: \$0\.5000/);
});

test('renderPolicy highlights over budget', () => {
  const summary = {
    month: '2026-06',
    totalTokens: 0,
    totalCostUsd: 100,
    requestCount: 0,
    budgetUsd: 50,
    budgetUsedPct: 200,
    overBudget: true,
    nearBudget: false,
  };
  const md = renderPolicy(DEFAULT_POLICY, summary);
  assert.match(md, /OVER BUDGET/);
});

test('renderPolicy highlights near budget', () => {
  const summary = {
    month: '2026-06',
    totalTokens: 0,
    totalCostUsd: 8,
    requestCount: 0,
    budgetUsd: 10,
    budgetUsedPct: 80,
    overBudget: false,
    nearBudget: true,
  };
  const md = renderPolicy(DEFAULT_POLICY, summary);
  assert.match(md, /Near budget/);
});

test('setBudget updates budget and persists', () => {
  const cwd = makeTmp();
  try {
    const updated = setBudget(cwd, { monthlyUsd: 100, perRequestUsd: 2, warnAtPct: 90 });
    assert.equal(updated.budget.monthlyUsd, 100);
    assert.equal(updated.budget.perRequestUsd, 2);
    const reloaded = readPolicy(cwd);
    assert.equal(reloaded.budget.monthlyUsd, 100);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('setBudget partial update preserves other fields', () => {
  const cwd = makeTmp();
  try {
    setBudget(cwd, { monthlyUsd: 200 });
    const reloaded = readPolicy(cwd);
    assert.equal(reloaded.budget.monthlyUsd, 200);
    assert.equal(reloaded.budget.perRequestUsd, DEFAULT_POLICY.budget.perRequestUsd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('addDenyRule appends to deny list', () => {
  const cwd = makeTmp();
  try {
    const updated = addDenyRule(cwd, '**/private/**', 'private data');
    assert.ok(updated.denyList.some((r) => r.pattern === '**/private/**'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('removeDenyRule removes by pattern', () => {
  const cwd = makeTmp();
  try {
    addDenyRule(cwd, '**/test/**', 'test');
    const updated = removeDenyRule(cwd, '**/test/**');
    assert.equal(updated.denyList.some((r) => r.pattern === '**/test/**'), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('removeDenyRule keeps other rules', () => {
  const cwd = makeTmp();
  try {
    addDenyRule(cwd, '**/a/**', 'a');
    addDenyRule(cwd, '**/b/**', 'b');
    const updated = removeDenyRule(cwd, '**/a/**');
    assert.equal(updated.denyList.some((r) => r.pattern === '**/a/**'), false);
    assert.equal(updated.denyList.some((r) => r.pattern === '**/b/**'), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('checkDenyList returns allowed for non-matching path', () => {
  const cwd = makeTmp();
  try {
    writePolicy(cwd, DEFAULT_POLICY);
    const result = checkDenyList(cwd, 'src/foo.ts');
    assert.equal(result.allowed, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('checkDenyList returns denied for matching path', () => {
  const cwd = makeTmp();
  try {
    writePolicy(cwd, DEFAULT_POLICY);
    const result = checkDenyList(cwd, '.env.production');
    assert.equal(result.allowed, false);
    assert.ok(result.reason);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('recordToolUsage appends to usage ledger', () => {
  const cwd = makeTmp();
  try {
    writePolicy(cwd, DEFAULT_POLICY);
    const result = recordToolUsage(cwd, { tool: 'search_memory', estTokens: 1000, model: 'claude', traceId: 'abc' });
    assert.ok(result.cost > 0);
    assert.equal(typeof result.overBudget, 'boolean');
    assert.ok(existsSync(join(cwd, '.ai-runtime', 'usage.jsonl')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
