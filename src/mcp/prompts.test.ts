import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptList, reviewModule, explainCycle, findSecurityIssue, summarizeRecentChanges, onboardNewDev, prePrReview } from './prompts.js';

test('buildPromptList returns 6 prompts', () => {
  const list = buildPromptList();
  const names = list.map((p) => p.name);
  for (const expected of ['review_module', 'explain_cycle', 'find_security_issue', 'summarize_recent_changes', 'onboard_new_dev', 'pre_pr_review']) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
});

test('every prompt has a description', () => {
  const list = buildPromptList();
  for (const p of list) {
    assert.ok(p.description.length > 0, `${p.name} missing description`);
  }
});

test('reviewModule requires module argument', () => {
  const p = buildPromptList().find((p) => p.name === 'review_module')!;
  const argNames = p.arguments.map((a) => a.name);
  assert.ok(argNames.includes('module'));
  assert.equal(p.arguments.find((a) => a.name === 'module')?.required, true);
});

test('reviewModule handler returns message with module path', async () => {
  const result = await reviewModule({ module: 'src/auth.ts' });
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0]?.content.text ?? '', /src\/auth\.ts/);
});

test('explainCycle handler mentions cycle', async () => {
  const result = await explainCycle({ cycle: 'a.ts,b.ts,a.ts' });
  assert.match(result.messages[0]?.content.text ?? '', /a\.ts.*b\.ts/);
});

test('findSecurityIssue defaults to "all"', async () => {
  const result = await findSecurityIssue({});
  assert.match(result.messages[0]?.content.text ?? '', /all/);
});

test('summarizeRecentChanges defaults to 7d', async () => {
  const result = await summarizeRecentChanges({});
  assert.match(result.messages[0]?.content.text ?? '', /7d/);
});

test('onboardNewDev mentions key resources', async () => {
  const result = await onboardNewDev({});
  const text = result.messages[0]?.content.text ?? '';
  assert.match(text, /aion:\/\/project\/context/);
  assert.match(text, /aion:\/\/docs\/architecture/);
});

test('prePrReview mentions PIL sync', async () => {
  const result = await prePrReview({});
  assert.match(result.messages[0]?.content.text ?? '', /aion sync/);
});

test('all handlers return PromptResult shape', async () => {
  const list = buildPromptList();
  for (const p of list) {
    const result = await p.handler({});
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.role, 'user');
    assert.equal(result.messages[0]?.content.type, 'text');
  }
});

test('findSecurityIssue scopes to a specific path', async () => {
  const result = await findSecurityIssue({ scope: 'src/auth.ts' });
  assert.match(result.messages[0]?.content.text ?? '', /src\/auth\.ts/);
});
