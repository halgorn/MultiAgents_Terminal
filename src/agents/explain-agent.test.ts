import test from 'node:test';
import assert from 'node:assert/strict';
import { ExplainAgent } from './explain-agent.js';
import type { ExplainInput } from './explain-agent.js';

class TestExplainAgent extends ExplainAgent {
  exposeMessage(input: ExplainInput): string {
    return (this as unknown as { buildUserMessage(i: ExplainInput): string }).buildUserMessage(input);
  }
  exposeParseOutput(text: string): string {
    return (this as unknown as { parseOutput(t: string): string }).parseOutput(text);
  }
  exposeResolveState(): string {
    return (this as unknown as { resolveState(o: unknown): string }).resolveState('');
  }
}

// ── buildUserMessage ──────────────────────────────────────────────────────────

test('ExplainAgent.buildUserMessage (explain mode): starts with "Explain for:"', () => {
  const agent = new TestExplainAgent('explain');
  const msg = agent.exposeMessage({
    worktreePath: '/tmp/repo',
    mode: 'explain',
    target: 'src/auth.ts',
    context: 'AuthService handles JWT tokens.',
  });
  assert.ok(msg.startsWith('Explain'), 'should start with Explain label');
  assert.ok(msg.includes('src/auth.ts'), 'should include target file');
});

test('ExplainAgent.buildUserMessage (impact mode): includes "Impact analysis" label', () => {
  const agent = new TestExplainAgent('impact');
  const msg = agent.exposeMessage({
    worktreePath: '/tmp/repo',
    mode: 'impact',
    target: 'src/utils.ts',
    context: 'Utility functions used across the codebase.',
  });
  assert.ok(msg.includes('Impact analysis'), 'should include Impact analysis label');
});

test('ExplainAgent.buildUserMessage (onboard mode): includes "Onboarding guide" label', () => {
  const agent = new TestExplainAgent('onboard');
  const msg = agent.exposeMessage({
    worktreePath: '/tmp/repo',
    mode: 'onboard',
    target: 'project',
    context: 'A TypeScript multi-agent system.',
  });
  assert.ok(msg.includes('Onboarding guide'), 'should include Onboarding guide label');
});

test('ExplainAgent.buildUserMessage: includes context block in message', () => {
  const agent = new TestExplainAgent('explain');
  const context = 'This file exports the BaseAgent class.';
  const msg = agent.exposeMessage({
    worktreePath: '/tmp/repo',
    mode: 'explain',
    target: 'src/agents/base-agent.ts',
    context,
  });
  assert.ok(msg.includes(context), 'context block should appear in message');
});

test('ExplainAgent.buildUserMessage: instructs to use Read tool', () => {
  const agent = new TestExplainAgent('explain');
  const msg = agent.exposeMessage({
    worktreePath: '/tmp/repo',
    mode: 'explain',
    target: 'src/foo.ts',
    context: '',
  });
  assert.ok(msg.includes('Read tool'), 'should instruct agent to use Read tool');
});

// ── parseOutput ───────────────────────────────────────────────────────────────

test('ExplainAgent.parseOutput: returns trimmed text', () => {
  const agent = new TestExplainAgent('explain');
  const result = agent.exposeParseOutput('  Some explanation.\n\n');
  assert.equal(result, 'Some explanation.');
});

test('ExplainAgent.parseOutput: empty text returns empty string', () => {
  const agent = new TestExplainAgent('explain');
  assert.equal(agent.exposeParseOutput('   '), '');
});

// ── resolveState ──────────────────────────────────────────────────────────────

test('ExplainAgent.resolveState: always returns DONE', () => {
  const agent = new TestExplainAgent('explain');
  assert.equal(agent.exposeResolveState(), 'DONE');
});
