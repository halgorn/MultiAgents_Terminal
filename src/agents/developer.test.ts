import test from 'node:test';
import assert from 'node:assert/strict';
import { DeveloperAgent } from './developer.js';
import type { DeveloperInput } from './developer.js';
import type { EvidenceReport } from '../schemas/evidence.js';
import type { PlanReport } from '../schemas/plan.js';

class TestDeveloperAgent extends DeveloperAgent {
  exposeMessage(input: DeveloperInput): string {
    return (this as unknown as { buildUserMessage(i: DeveloperInput): string }).buildUserMessage(input);
  }
  exposeParseOutput(text: string) {
    return (this as unknown as { parseOutput(t: string): unknown }).parseOutput(text);
  }
  exposeResolveState() {
    return (this as unknown as { resolveState(): string }).resolveState();
  }
}

function makeEvidence(overrides: Partial<EvidenceReport> = {}): EvidenceReport {
  return {
    reproduced: true,
    summary: 'Null pointer dereference in auth handler',
    rootCause: 'Missing null check before accessing user.id',
    files: [{ path: 'src/auth.ts', line: 42, snippet: 'const id = user.id;' }],
    confidence: 90,
    stackTrace: null,
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanReport> = {}): PlanReport {
  return {
    taskId: 'task-001',
    summary: 'Fix null dereference',
    phases: [{
      name: 'Fix',
      description: 'Apply null guard to auth handler',
      targetFiles: ['src/auth.ts'],
      agentType: 'developer',
    }],
    riskLevel: 'low',
    estimatedFiles: ['src/auth.ts'],
    constraints: ['Do not break existing tests', 'Add null guard'],
    relevantModules: ['auth'],
    ...overrides,
  };
}

const agent = new TestDeveloperAgent();

// ── buildUserMessage ───────────────────────────────────────────────────────────

test('DeveloperAgent: buildUserMessage includes root cause', () => {
  const input: DeveloperInput = { evidence: makeEvidence(), plan: makePlan(), worktreePath: '/tmp' };
  const msg = agent.exposeMessage(input);
  assert.ok(msg.includes('Missing null check'), `expected root cause in message, got: ${msg}`);
});

test('DeveloperAgent: buildUserMessage falls back to summary when no rootCause', () => {
  const evidence = makeEvidence({ rootCause: undefined });
  const input: DeveloperInput = { evidence, plan: makePlan(), worktreePath: '/tmp' };
  const msg = agent.exposeMessage(input);
  assert.ok(msg.includes('Null pointer dereference'), 'should include summary when rootCause missing');
});

test('DeveloperAgent: buildUserMessage includes evidence file path and snippet', () => {
  const input: DeveloperInput = { evidence: makeEvidence(), plan: makePlan(), worktreePath: '/tmp' };
  const msg = agent.exposeMessage(input);
  assert.ok(msg.includes('src/auth.ts:42'), 'should include file path and line');
  assert.ok(msg.includes('const id = user.id'), 'should include snippet');
});

test('DeveloperAgent: buildUserMessage includes plan constraints', () => {
  const input: DeveloperInput = { evidence: makeEvidence(), plan: makePlan(), worktreePath: '/tmp' };
  const msg = agent.exposeMessage(input);
  assert.ok(msg.includes('Do not break existing tests'), 'should include first constraint');
  assert.ok(msg.includes('Add null guard'), 'should include second constraint');
});

test('DeveloperAgent: buildUserMessage defaults to npm commands when no langProfile', () => {
  const input: DeveloperInput = { evidence: makeEvidence(), plan: makePlan(), worktreePath: '/tmp' };
  const msg = agent.exposeMessage(input);
  assert.ok(msg.includes('npm run build'), 'default build command');
  assert.ok(msg.includes('npm test'), 'default test command');
});

test('DeveloperAgent: buildUserMessage uses langProfile build/test commands', () => {
  const input: DeveloperInput = {
    evidence: makeEvidence(),
    plan: makePlan(),
    worktreePath: '/tmp',
    langProfile: { lang: 'python', buildCommand: 'python -m build', testCommand: 'pytest' },
  };
  const msg = agent.exposeMessage(input);
  assert.ok(msg.includes('python -m build'), 'should use langProfile build command');
  assert.ok(msg.includes('pytest'), 'should use langProfile test command');
  assert.ok(msg.includes('python'), 'should include language');
});

// ── parseOutput ────────────────────────────────────────────────────────────────

test('DeveloperAgent: parseOutput accepts valid PatchReport JSON', () => {
  const json = JSON.stringify({
    filesChanged: ['src/auth.ts'],
    diff: '- const id = user.id;\n+ const id = user?.id;',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    description: 'Added null guard',
    risksIntroduced: [],
  });
  const result = agent.exposeParseOutput(json) as { description: string };
  assert.equal(result.description, 'Added null guard');
});

test('DeveloperAgent: parseOutput throws on invalid schema (empty filesChanged)', () => {
  const json = JSON.stringify({
    filesChanged: [],
    diff: 'some diff',
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    description: 'Fix',
    risksIntroduced: [],
  });
  assert.throws(() => agent.exposeParseOutput(json), /schema error/i);
});

// ── resolveState ───────────────────────────────────────────────────────────────

test('DeveloperAgent: resolveState returns PATCH_CREATED', () => {
  assert.equal(agent.exposeResolveState(), 'PATCH_CREATED');
});
