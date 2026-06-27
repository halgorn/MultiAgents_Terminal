import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeveloperPrompt } from './developer.js';
import { buildExplainPrompt } from './explain.js';
import { buildReviewerPrompt } from './reviewer.js';
import { buildQAPrompt } from './qa.js';

// ── buildDeveloperPrompt ──────────────────────────────────────────────────────

test('buildDeveloperPrompt: returns string with Role header', () => {
  const prompt = buildDeveloperPrompt();
  assert.ok(/^# Role/m.test(prompt), 'should have a Role section');
  assert.ok(prompt.includes('Developer'), 'should name the role');
});

test('buildDeveloperPrompt: includes allowed tools section', () => {
  const prompt = buildDeveloperPrompt();
  assert.ok(prompt.includes('## Allowed Tools'), 'should have Allowed Tools section');
  assert.match(prompt, /Read|Edit|Write/);
});

test('buildDeveloperPrompt: specifies output JSON via Zod schema', () => {
  const prompt = buildDeveloperPrompt();
  assert.ok(prompt.includes('## Output'), 'should have Output section');
  assert.match(prompt, /JSON/i);
});

test('buildDeveloperPrompt: includes injection defense by default', () => {
  const prompt = buildDeveloperPrompt();
  assert.ok(prompt.includes('UNTRUSTED'), 'should have injection defense');
});

// ── buildReviewerPrompt ───────────────────────────────────────────────────────

test('buildReviewerPrompt: returns string with Role header', () => {
  const prompt = buildReviewerPrompt();
  assert.ok(/^# Role/m.test(prompt));
  assert.ok(prompt.includes('Reviewer'));
});

test('buildReviewerPrompt: prohibits Write/Edit tools', () => {
  const prompt = buildReviewerPrompt();
  assert.ok(!prompt.includes('Write, Edit') || prompt.includes('NO Write'), 'should not allow Write/Edit');
});

test('buildReviewerPrompt: specifies output structure', () => {
  const prompt = buildReviewerPrompt();
  assert.ok(prompt.includes('## Output'));
});

// ── buildQAPrompt ────────────────────────────────────────────────────────────

test('buildQAPrompt: returns string with Role header', () => {
  const prompt = buildQAPrompt();
  assert.ok(/^# Role/m.test(prompt));
  assert.ok(prompt.includes('QA'));
});

test('buildQAPrompt: prohibits Write/Edit tools', () => {
  const prompt = buildQAPrompt();
  assert.ok(!prompt.includes('Write, Edit') || prompt.includes('NO Write'), 'should not allow Write/Edit');
});

test('buildQAPrompt: specifies output structure', () => {
  const prompt = buildQAPrompt();
  assert.ok(prompt.includes('## Output'));
});

// ── buildExplainPrompt ──────────────────────────────────────────────────────

test('buildExplainPrompt: explain mode produces prompt', () => {
  const prompt = buildExplainPrompt('explain');
  assert.ok(/^# Role/m.test(prompt));
  assert.match(prompt, /engineer|code/i);
});

test('buildExplainPrompt: impact mode produces prompt', () => {
  const prompt = buildExplainPrompt('impact');
  assert.ok(/^# Role/m.test(prompt));
});

test('buildExplainPrompt: onboard mode produces prompt', () => {
  const prompt = buildExplainPrompt('onboard');
  assert.ok(/^# Role/m.test(prompt));
});