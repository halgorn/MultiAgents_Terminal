import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeveloperPrompt } from './developer.js';
import { buildExplainPrompt } from './explain.js';
import { buildReviewerPrompt } from './reviewer.js';
import { buildQAPrompt } from './qa.js';

// ── buildDeveloperPrompt ──────────────────────────────────────────────────────

test('buildDeveloperPrompt: returns string with Role header', () => {
  const prompt = buildDeveloperPrompt();
  assert.ok(prompt.includes('Developer Agent'), 'should name the role');
});

test('buildDeveloperPrompt: includes allowed tools section', () => {
  const prompt = buildDeveloperPrompt();
  assert.ok(prompt.includes('Read') && prompt.includes('Edit'), 'should mention Read and Edit tools');
  assert.ok(prompt.includes('NO test execution'), 'should prohibit test execution');
});

test('buildDeveloperPrompt: specifies JSON output shape with required fields', () => {
  const prompt = buildDeveloperPrompt();
  assert.ok(prompt.includes('"filesChanged"'), 'should include filesChanged');
  assert.ok(prompt.includes('"diff"'), 'should include diff field');
  assert.ok(prompt.includes('"risksIntroduced"'), 'should include risksIntroduced');
});

// ── buildExplainPrompt ────────────────────────────────────────────────────────

test('buildExplainPrompt(explain): mentions module responsibility', () => {
  const prompt = buildExplainPrompt('explain');
  assert.ok(prompt.includes('primary responsibility') || prompt.includes('What this module does'), 'should explain responsibility');
});

test('buildExplainPrompt(impact): includes blast radius concept', () => {
  const prompt = buildExplainPrompt('impact');
  assert.ok(prompt.includes('blast radius'), 'should mention blast radius');
});

test('buildExplainPrompt(onboard): mentions onboarding and architecture', () => {
  const prompt = buildExplainPrompt('onboard');
  assert.ok(prompt.includes('onboarding') || prompt.includes('new developer'), 'should target new developers');
  assert.ok(prompt.includes('architect'), 'should describe architecture');
});

test('buildExplainPrompt: three modes return distinct strings', () => {
  const explain = buildExplainPrompt('explain');
  const impact = buildExplainPrompt('impact');
  const onboard = buildExplainPrompt('onboard');
  assert.notEqual(explain, impact);
  assert.notEqual(explain, onboard);
  assert.notEqual(impact, onboard);
});

// ── buildReviewerPrompt ───────────────────────────────────────────────────────

test('buildReviewerPrompt: includes 10 review personas', () => {
  const prompt = buildReviewerPrompt();
  assert.ok(prompt.includes('backend') && prompt.includes('security') && prompt.includes('QA'), 'should list review personas');
});

test('buildReviewerPrompt: specifies approved boolean in output schema', () => {
  const prompt = buildReviewerPrompt();
  assert.ok(prompt.includes('"approved": boolean'), 'should include approved field');
  assert.ok(prompt.includes('"regressionRisk"'), 'should include regressionRisk');
});

test('buildReviewerPrompt: prohibits Write and Edit tools', () => {
  const prompt = buildReviewerPrompt();
  assert.ok(prompt.includes('NO Write'), 'should prohibit Write tool');
});

// ── buildQAPrompt ─────────────────────────────────────────────────────────────

test('buildQAPrompt: includes buildOk and testsOk in output schema', () => {
  const prompt = buildQAPrompt();
  assert.ok(prompt.includes('"buildOk"'), 'should include buildOk');
  assert.ok(prompt.includes('"testsOk"'), 'should include testsOk');
  assert.ok(prompt.includes('"reproductionStillFails"'), 'should include reproductionStillFails');
});

test('buildQAPrompt: specifies Bash as allowed tool for running commands', () => {
  const prompt = buildQAPrompt();
  assert.ok(prompt.includes('Bash'), 'should allow Bash for running build/test');
});

test('buildQAPrompt: prohibits Write and Edit tools', () => {
  const prompt = buildQAPrompt();
  assert.ok(prompt.includes('NO Write'), 'should prohibit Write tool');
});
