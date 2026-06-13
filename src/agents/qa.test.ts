import test from 'node:test';
import assert from 'node:assert/strict';
import { QAAgent } from './qa.js';
import type { QAInput } from './qa.js';
import type { PatchReport } from '../schemas/patch.js';
import type { EvidenceReport } from '../schemas/evidence.js';

class TestQAAgent extends QAAgent {
  exposeMessage(input: QAInput): string {
    return (this as unknown as { buildUserMessage(i: QAInput): string }).buildUserMessage(input);
  }
  exposeParseOutput(text: string) {
    return (this as unknown as { parseOutput(t: string): unknown }).parseOutput(text);
  }
  exposeResolveState(output: { buildOk: boolean; testsOk: boolean; reproductionStillFails: boolean }) {
    return (this as unknown as { resolveState(o: typeof output): string }).resolveState(output);
  }
}

const agent = new TestQAAgent();

function makePatch(overrides: Partial<PatchReport> = {}): PatchReport {
  return {
    filesChanged: ['src/auth.ts'],
    diff: '+ user?.id',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    description: 'Add null guard',
    risksIntroduced: [],
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<EvidenceReport> = {}): EvidenceReport {
  return {
    reproduced: true,
    summary: 'NPE in auth handler',
    confidence: 90,
    files: [],
    logs: ['Error: null', 'at auth.ts:42'],
    ...overrides,
  };
}

// ── buildUserMessage ───────────────────────────────────────────────────────────

test('QAAgent: message includes build command', () => {
  const msg = agent.exposeMessage({ patch: makePatch(), evidence: makeEvidence(), worktreePath: '/tmp' });
  assert.ok(msg.includes('npm run build'), 'should include build command');
});

test('QAAgent: message includes test command', () => {
  const msg = agent.exposeMessage({ patch: makePatch(), evidence: makeEvidence(), worktreePath: '/tmp' });
  assert.ok(msg.includes('npm test'), 'should include test command');
});

test('QAAgent: message includes bug summary', () => {
  const msg = agent.exposeMessage({ patch: makePatch(), evidence: makeEvidence(), worktreePath: '/tmp' });
  assert.ok(msg.includes('NPE in auth handler'), 'should include bug summary');
});

test('QAAgent: message includes evidence logs (up to 5)', () => {
  const evidence = makeEvidence({ logs: ['log1', 'log2', 'log3', 'log4', 'log5', 'log6'] });
  const msg = agent.exposeMessage({ patch: makePatch(), evidence, worktreePath: '/tmp' });
  assert.ok(msg.includes('log1'), 'should include first log');
  assert.ok(msg.includes('log5'), 'should include fifth log');
  assert.ok(!msg.includes('log6'), 'should not include sixth log (capped at 5)');
});

// ── parseOutput ────────────────────────────────────────────────────────────────

test('QAAgent: parseOutput accepts valid QAResult JSON', () => {
  const json = JSON.stringify({
    buildOk: true,
    testsOk: true,
    lintOk: true,
    reproductionStillFails: false,
    testOutput: 'All tests passed',
    buildOutput: 'Build succeeded',
  });
  const result = agent.exposeParseOutput(json) as { testOutput: string };
  assert.equal(result.testOutput, 'All tests passed');
});

test('QAAgent: parseOutput throws on missing required fields', () => {
  const json = JSON.stringify({ buildOk: true });
  assert.throws(() => agent.exposeParseOutput(json), /schema error/i);
});

// ── resolveState: all 4 meaningful branches ────────────────────────────────────

test('QAAgent: resolveState returns TESTED when build+tests pass and bug is fixed', () => {
  assert.equal(
    agent.exposeResolveState({ buildOk: true, testsOk: true, reproductionStillFails: false }),
    'TESTED',
  );
});

test('QAAgent: resolveState returns FAILED when build fails', () => {
  assert.equal(
    agent.exposeResolveState({ buildOk: false, testsOk: true, reproductionStillFails: false }),
    'FAILED',
  );
});

test('QAAgent: resolveState returns FAILED when tests fail', () => {
  assert.equal(
    agent.exposeResolveState({ buildOk: true, testsOk: false, reproductionStillFails: false }),
    'FAILED',
  );
});

test('QAAgent: resolveState returns FAILED when reproduction still fails', () => {
  assert.equal(
    agent.exposeResolveState({ buildOk: true, testsOk: true, reproductionStillFails: true }),
    'FAILED',
  );
});
