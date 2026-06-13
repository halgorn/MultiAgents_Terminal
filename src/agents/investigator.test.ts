import test from 'node:test';
import assert from 'node:assert/strict';
import { InvestigatorAgent } from './investigator.js';
import type { InvestigatorInput } from './investigator.js';
import type { PlanReport } from '../schemas/plan.js';

class TestInvestigatorAgent extends InvestigatorAgent {
  exposeMessage(input: InvestigatorInput): string {
    return (this as unknown as { buildUserMessage(i: InvestigatorInput): string }).buildUserMessage(input);
  }
  exposeParseOutput(text: string) {
    return (this as unknown as { parseOutput(t: string): unknown }).parseOutput(text);
  }
  exposeResolveState(output: { reproduced: boolean }) {
    return (this as unknown as { resolveState(o: { reproduced: boolean }): string }).resolveState(output);
  }
}

const agent = new TestInvestigatorAgent('runtime');

function makePlan(overrides: Partial<PlanReport> = {}): PlanReport {
  return {
    taskId: 'task-1',
    summary: 'Auth handler NPE plan',
    phases: [{
      name: 'Investigate',
      description: 'Find the null dereference',
      targetFiles: ['src/auth.ts'],
      agentType: 'investigator',
    }],
    riskLevel: 'low',
    estimatedFiles: ['src/auth.ts', 'src/user.ts'],
    constraints: ['Do not break tests'],
    relevantModules: ['auth', 'user'],
    ...overrides,
  };
}

function makeInput(overrides: Partial<InvestigatorInput> = {}): InvestigatorInput {
  return {
    plan: makePlan(),
    bugDescription: 'NPE when user is null in auth handler',
    worktreePath: '/tmp',
    domain: 'runtime',
    ...overrides,
  };
}

// ── buildUserMessage ───────────────────────────────────────────────────────────

test('InvestigatorAgent: message includes bug description', () => {
  const msg = agent.exposeMessage(makeInput());
  assert.ok(msg.includes('NPE when user is null'), 'should include bug description');
});

test('InvestigatorAgent: message includes plan summary', () => {
  const msg = agent.exposeMessage(makeInput());
  assert.ok(msg.includes('Auth handler NPE plan'), 'should include plan summary');
});

test('InvestigatorAgent: message includes estimated files', () => {
  const msg = agent.exposeMessage(makeInput());
  assert.ok(msg.includes('src/auth.ts'), 'should include estimated file');
  assert.ok(msg.includes('src/user.ts'), 'should include second estimated file');
});

test('InvestigatorAgent: message includes relevant modules', () => {
  const msg = agent.exposeMessage(makeInput());
  assert.ok(msg.includes('auth'), 'should include relevant module');
  assert.ok(msg.includes('user'), 'should include second module');
});

test('InvestigatorAgent: message includes domain focus', () => {
  const msg = agent.exposeMessage(makeInput());
  assert.ok(msg.includes('runtime'), 'should include domain focus');
});

// ── parseOutput ────────────────────────────────────────────────────────────────

test('InvestigatorAgent: parseOutput accepts valid EvidenceReport JSON', () => {
  const json = JSON.stringify({
    reproduced: true,
    confidence: 85,
    summary: 'Confirmed NPE at line 42',
    files: [{ path: 'src/auth.ts', line: 42, snippet: 'user.id' }],
    logs: ['Error: Cannot read property id of null'],
  });
  const result = agent.exposeParseOutput(json) as { summary: string };
  assert.equal(result.summary, 'Confirmed NPE at line 42');
});

test('InvestigatorAgent: parseOutput throws when confidence out of range', () => {
  const json = JSON.stringify({
    reproduced: false,
    confidence: 150,
    summary: 'Could not reproduce',
  });
  assert.throws(() => agent.exposeParseOutput(json), /schema error/i);
});

// ── resolveState ───────────────────────────────────────────────────────────────

test('InvestigatorAgent: resolveState returns REPRODUCED when reproduced is true', () => {
  assert.equal(agent.exposeResolveState({ reproduced: true }), 'REPRODUCED');
});

test('InvestigatorAgent: resolveState returns FAILED when reproduced is false', () => {
  assert.equal(agent.exposeResolveState({ reproduced: false }), 'FAILED');
});
