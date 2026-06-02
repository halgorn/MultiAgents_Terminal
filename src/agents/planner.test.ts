import test from 'node:test';
import assert from 'node:assert/strict';
import { PlannerAgent, type PlannerInput } from './planner.js';

class TestPlannerAgent extends PlannerAgent {
  exposeMessage(input: PlannerInput): string {
    return this.buildUserMessage(input);
  }
}

test('PlannerAgent includes deterministic repository index context', () => {
  const agent = new TestPlannerAgent();
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
