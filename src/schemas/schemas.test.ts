import test from 'node:test';
import assert from 'node:assert/strict';
import { PatchReportSchema } from './patch.js';
import { EvidenceReportSchema } from './evidence.js';
import { ReviewReportSchema, ReviewFindingSchema } from './review.js';
import { QAResultSchema } from './qa.js';
import { PlanReportSchema, PlanPhaseSchema } from './plan.js';

// ── PatchReportSchema ─────────────────────────────────────────────────────────

test('PatchReportSchema: valid patch report parses', () => {
  const result = PatchReportSchema.parse({
    filesChanged: ['src/auth.ts'],
    diff: '--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-old\n+new',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    description: 'Fix auth bug',
    risksIntroduced: [],
  });
  assert.deepEqual(result.filesChanged, ['src/auth.ts']);
});

test('PatchReportSchema: rejects empty filesChanged', () => {
  assert.throws(() => PatchReportSchema.parse({
    filesChanged: [],
    diff: 'some diff',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    description: 'fix',
    risksIntroduced: [],
  }), /at least 1/);
});

test('PatchReportSchema: rejects empty diff', () => {
  assert.throws(() => PatchReportSchema.parse({
    filesChanged: ['src/a.ts'],
    diff: '',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    description: 'fix',
    risksIntroduced: [],
  }));
});

// ── EvidenceReportSchema ──────────────────────────────────────────────────────

test('EvidenceReportSchema: valid evidence report parses', () => {
  const result = EvidenceReportSchema.parse({
    reproduced: true,
    confidence: 85,
    summary: 'Auth failure reproduced.',
  });
  assert.equal(result.reproduced, true);
  assert.deepEqual(result.logs, []);
  assert.deepEqual(result.files, []);
});

test('EvidenceReportSchema: confidence below 0 is rejected', () => {
  assert.throws(() => EvidenceReportSchema.parse({
    reproduced: false,
    confidence: -1,
    summary: 'Failed.',
  }));
});

test('EvidenceReportSchema: confidence above 100 is rejected', () => {
  assert.throws(() => EvidenceReportSchema.parse({
    reproduced: false,
    confidence: 101,
    summary: 'Failed.',
  }));
});

test('EvidenceReportSchema: stackTrace is optional', () => {
  const withStack = EvidenceReportSchema.parse({ reproduced: true, confidence: 90, summary: 'ok', stackTrace: 'Error at line 5' });
  assert.equal(withStack.stackTrace, 'Error at line 5');
  const withoutStack = EvidenceReportSchema.parse({ reproduced: true, confidence: 90, summary: 'ok' });
  assert.ok(withoutStack.stackTrace == null, 'stackTrace should be null or undefined when absent');
});

// ── ReviewFindingSchema / ReviewReportSchema ──────────────────────────────────

test('ReviewFindingSchema: valid finding parses', () => {
  const f = ReviewFindingSchema.parse({
    severity: 'high',
    file: 'src/auth.ts',
    line: 42,
    description: 'SQL injection risk',
  });
  assert.equal(f.severity, 'high');
  assert.equal(f.file, 'src/auth.ts');
});

test('ReviewFindingSchema: rejects invalid severity', () => {
  assert.throws(() => ReviewFindingSchema.parse({
    severity: 'fatal',
    file: 'src/a.ts',
    description: 'issue',
  }));
});

test('ReviewReportSchema: defaults findings and blockers to empty arrays', () => {
  const r = ReviewReportSchema.parse({
    approved: true,
    regressionRisk: 'none',
    summary: 'Looks good.',
  });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.blockers, []);
});

test('ReviewReportSchema: rejects invalid regressionRisk', () => {
  assert.throws(() => ReviewReportSchema.parse({
    approved: false,
    regressionRisk: 'critical',
    summary: 'Issues found.',
  }));
});

// ── QAResultSchema ────────────────────────────────────────────────────────────

test('QAResultSchema: valid QA result parses', () => {
  const r = QAResultSchema.parse({
    buildOk: true,
    testsOk: true,
    lintOk: true,
    reproductionStillFails: false,
    testOutput: 'All tests passed.',
    buildOutput: 'Build successful.',
  });
  assert.equal(r.buildOk, true);
  assert.equal(r.failureReason, undefined);
});

test('QAResultSchema: failureReason is optional', () => {
  const ok = QAResultSchema.parse({ buildOk: true, testsOk: true, lintOk: true, reproductionStillFails: false, testOutput: '', buildOutput: '' });
  assert.equal(ok.failureReason, undefined);
  const failed = QAResultSchema.parse({ buildOk: false, testsOk: false, lintOk: true, reproductionStillFails: true, testOutput: '', buildOutput: '', failureReason: 'Tests failed' });
  assert.equal(failed.failureReason, 'Tests failed');
});

// ── PlanReportSchema ──────────────────────────────────────────────────────────

test('PlanPhaseSchema: valid phase parses', () => {
  const phase = PlanPhaseSchema.parse({
    name: 'Investigate',
    description: 'Understand the root cause.',
    targetFiles: ['src/auth.ts'],
    agentType: 'investigator',
  });
  assert.equal(phase.agentType, 'investigator');
});

test('PlanPhaseSchema: rejects invalid agentType', () => {
  assert.throws(() => PlanPhaseSchema.parse({
    name: 'Deploy',
    description: 'Deploy to prod.',
    targetFiles: [],
    agentType: 'deployer',
  }));
});

test('PlanReportSchema: valid plan report parses', () => {
  const plan = PlanReportSchema.parse({
    taskId: 'task-123',
    summary: 'Fix the auth bug.',
    phases: [{ name: 'Investigate', description: 'Root cause', targetFiles: ['src/auth.ts'], agentType: 'investigator' }],
    riskLevel: 'medium',
    estimatedFiles: ['src/auth.ts'],
    constraints: ['Do not change the API'],
    relevantModules: ['auth'],
  });
  assert.equal(plan.riskLevel, 'medium');
  assert.equal(plan.phases.length, 1);
});

test('PlanReportSchema: rejects empty phases array', () => {
  assert.throws(() => PlanReportSchema.parse({
    taskId: 'task-1',
    summary: 'Empty plan',
    phases: [],
    riskLevel: 'low',
    estimatedFiles: [],
    constraints: [],
    relevantModules: [],
  }), /at least 1/);
});
