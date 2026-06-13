import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewerAgent } from './reviewer.js';
import type { ReviewerInput } from './reviewer.js';
import type { EvidenceReport } from '../schemas/evidence.js';
import type { PatchReport } from '../schemas/patch.js';

class TestReviewerAgent extends ReviewerAgent {
  exposeMessage(input: ReviewerInput): string {
    return (this as unknown as { buildUserMessage(i: ReviewerInput): string }).buildUserMessage(input);
  }
  exposeParseOutput(text: string) {
    return (this as unknown as { parseOutput(t: string): unknown }).parseOutput(text);
  }
  exposeResolveState(output: { approved: boolean }) {
    return (this as unknown as { resolveState(o: { approved: boolean }): string }).resolveState(output);
  }
}

const agent = new TestReviewerAgent();

function makePatch(overrides: Partial<PatchReport> = {}): PatchReport {
  return {
    filesChanged: ['src/auth.ts'],
    diff: '- const id = user.id;\n+ const id = user?.id;',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    description: 'Added null guard to user.id access',
    risksIntroduced: ['edge case when user is undefined'],
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<EvidenceReport> = {}): EvidenceReport {
  return {
    reproduced: true,
    summary: 'Null pointer in auth handler',
    rootCause: 'user.id accessed without null check',
    files: [{ path: 'src/auth.ts', line: 42, snippet: 'const id = user.id;' }],
    confidence: 90,
    ...overrides,
  };
}

// ── buildUserMessage ───────────────────────────────────────────────────────────

test('ReviewerAgent: message includes patch description', () => {
  const msg = agent.exposeMessage({ patch: makePatch(), evidence: makeEvidence(), worktreePath: '/tmp' });
  assert.ok(msg.includes('Added null guard'), `expected patch description, got: ${msg}`);
});

test('ReviewerAgent: message includes changed file list', () => {
  const msg = agent.exposeMessage({ patch: makePatch(), evidence: makeEvidence(), worktreePath: '/tmp' });
  assert.ok(msg.includes('src/auth.ts'), 'should list changed files');
});

test('ReviewerAgent: message includes diff content', () => {
  const msg = agent.exposeMessage({ patch: makePatch(), evidence: makeEvidence(), worktreePath: '/tmp' });
  assert.ok(msg.includes('user?.id'), 'should include diff content');
});

test('ReviewerAgent: message includes developer-noted risks', () => {
  const msg = agent.exposeMessage({ patch: makePatch(), evidence: makeEvidence(), worktreePath: '/tmp' });
  assert.ok(msg.includes('edge case when user is undefined'), 'should include risks');
});

test('ReviewerAgent: message shows "none" when no risks introduced', () => {
  const patch = makePatch({ risksIntroduced: [] });
  const msg = agent.exposeMessage({ patch, evidence: makeEvidence(), worktreePath: '/tmp' });
  assert.ok(msg.includes('none'), 'empty risks array should render as "none"');
});

test('ReviewerAgent: message includes original root cause', () => {
  const msg = agent.exposeMessage({ patch: makePatch(), evidence: makeEvidence(), worktreePath: '/tmp' });
  assert.ok(msg.includes('user.id accessed without null check'), 'should include root cause');
});

test('ReviewerAgent: message falls back to evidence summary when no rootCause', () => {
  const evidence = makeEvidence({ rootCause: undefined });
  const msg = agent.exposeMessage({ patch: makePatch(), evidence, worktreePath: '/tmp' });
  assert.ok(msg.includes('Null pointer in auth handler'), 'should fall back to summary');
});

// ── parseOutput ────────────────────────────────────────────────────────────────

test('ReviewerAgent: parseOutput accepts valid ReviewReport JSON', () => {
  const json = JSON.stringify({
    approved: true,
    findings: [],
    regressionRisk: 'low',
    summary: 'LGTM',
    blockers: [],
  });
  const result = agent.exposeParseOutput(json) as { summary: string };
  assert.equal(result.summary, 'LGTM');
});

test('ReviewerAgent: parseOutput throws on invalid schema (invalid regressionRisk)', () => {
  const json = JSON.stringify({
    approved: true,
    findings: [],
    regressionRisk: 'unknown-value',
    summary: 'ok',
  });
  assert.throws(() => agent.exposeParseOutput(json), /schema error/i);
});

// ── resolveState ───────────────────────────────────────────────────────────────

test('ReviewerAgent: resolveState returns REVIEWED when approved', () => {
  assert.equal(agent.exposeResolveState({ approved: true }), 'REVIEWED');
});

test('ReviewerAgent: resolveState returns FAILED when not approved', () => {
  assert.equal(agent.exposeResolveState({ approved: false }), 'FAILED');
});
