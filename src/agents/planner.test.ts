import test from 'node:test';
import assert from 'node:assert/strict';
import { PlannerAgent, type PlannerInput } from './planner.js';

class TestPlannerAgent extends PlannerAgent {
  exposeMessage(input: PlannerInput): string {
    return this.buildUserMessage(input);
  }
  exposeParseOutput(text: string) {
    return (this as unknown as { parseOutput(t: string): unknown }).parseOutput(text);
  }
  exposeResolveState() {
    return (this as unknown as { resolveState(): string }).resolveState();
  }
}

const agent = new TestPlannerAgent();

function makeInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    taskId: 'task-1',
    bugDescription: 'NPE in auth handler when user is null',
    codebaseSummary: 'Auth module at src/auth.ts',
    worktreePath: '/tmp',
    ...overrides,
  };
}

test('PlannerAgent includes deterministic repository index context', () => {
  const message = agent.exposeMessage({
    taskId: 'task-1',
    bugDescription: 'fix auth',
    codebaseSummary: '',
    repoContext: 'Files:\n  src/auth.ts',
    worktreePath: '/tmp/repo',
  });

  assert.match(message, /Deterministic repository index context/);
  assert.match(message, /src\/auth.ts/);
});

test('PlannerAgent: message includes task ID', () => {
  const msg = agent.exposeMessage(makeInput({ taskId: 'task-999' }));
  assert.ok(msg.includes('task-999'), 'should include taskId');
});

test('PlannerAgent: message includes bug description', () => {
  const msg = agent.exposeMessage(makeInput());
  assert.ok(msg.includes('NPE in auth handler'), 'should include bug description');
});

test('PlannerAgent: message shows (none) when codebaseSummary is empty', () => {
  const msg = agent.exposeMessage(makeInput({ codebaseSummary: '' }));
  assert.ok(msg.includes('(none)'), 'empty summary renders as (none)');
});

test('PlannerAgent: message shows fallback hint when repoContext is missing', () => {
  const msg = agent.exposeMessage(makeInput({ repoContext: undefined }));
  assert.ok(msg.includes('repo index not built'), 'should show fallback hint');
});

test('PlannerAgent: parseOutput accepts valid PlanReport JSON', () => {
  const json = JSON.stringify({
    taskId: 'task-1',
    summary: 'Add null guard',
    phases: [{
      name: 'Fix',
      description: 'Apply null guard',
      targetFiles: ['src/auth.ts'],
      agentType: 'developer',
    }],
    riskLevel: 'low',
    estimatedFiles: ['src/auth.ts'],
    constraints: ['Keep existing tests'],
    relevantModules: ['auth'],
  });
  const result = agent.exposeParseOutput(json) as { summary: string };
  assert.equal(result.summary, 'Add null guard');
});

test('PlannerAgent: parseOutput throws on empty phases array', () => {
  const json = JSON.stringify({
    taskId: 'task-1', summary: 'Fix', phases: [], riskLevel: 'low',
    estimatedFiles: [], constraints: [], relevantModules: [],
  });
  assert.throws(() => agent.exposeParseOutput(json), /schema error/i);
});

test('PlannerAgent: parseOutput throws on invalid riskLevel', () => {
  const json = JSON.stringify({
    taskId: 'task-1', summary: 'Fix',
    phases: [{ name: 'F', description: 'd', targetFiles: [], agentType: 'developer' }],
    riskLevel: 'critical', estimatedFiles: [], constraints: [], relevantModules: [],
  });
  assert.throws(() => agent.exposeParseOutput(json), /schema error/i);
});

test('PlannerAgent: resolveState returns INVESTIGATING', () => {
  assert.equal(agent.exposeResolveState(), 'INVESTIGATING');
});
