import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { EventEmitter } from 'events';
import { Orchestrator } from './orchestrator.js';
import { TaskState, assertTransition, canTransition } from './state-machine.js';
import { makeFixtureRepo } from '../test-utils/fixtures.js';

function git(repo: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initGitRepo(repo: string): void {
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Aion Test']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'initial']);
}

function makeFakeClaude(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'aion-pipeline-bin-'));
  const file = join(dir, 'claude');
  writeFileSync(file, `#!/usr/bin/env node
const promptIndex = process.argv.indexOf('-p');
const prompt = promptIndex >= 0 ? process.argv[promptIndex + 1] : '';
const usage = ' tokens:10:5:0:0 ';
let result;
if (prompt.includes('Then output the plan JSON')) {
  result = {
    taskId: 'task-1',
    summary: 'low risk documentation lookup',
    riskLevel: 'low',
    relevantModules: ['src/app.ts'],
    estimatedFiles: ['src/app.ts'],
    phases: [{ name: 'inspect', description: 'inspect locally', targetFiles: ['src/app.ts'], agentType: 'developer' }],
    constraints: ['offline'],
  };
} else if (prompt.includes('Then output the review JSON')) {
  result = { approved: true, summary: 'approved', findings: [], regressionRisk: 'low', blockers: [] };
} else {
  result = { reproduced: true, confidence: 90, logs: ['ok'], files: [{ path: 'src/app.ts', line: 1, snippet: 'export' }], summary: 'ok' };
}
process.stderr.write(usage);
process.stdout.write(JSON.stringify({ result: JSON.stringify(result) }));
`, 'utf8');
  chmodSync(file, 0o755);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function withPath<T>(pathPrefix: string, fn: () => Promise<T>): Promise<T> {
  const originalPath = process.env.PATH;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalOpenRouter = process.env.OPENROUTER_API_KEY;
  process.env.PATH = `${pathPrefix}:${originalPath ?? ''}`;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  return fn().finally(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropic;
    if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouter;
  });
}

test('state machine only allows declared task transitions', () => {
  assert.equal(canTransition(TaskState.NEW, TaskState.INVESTIGATING), true);
  assert.equal(canTransition(TaskState.NEW, TaskState.DONE), false);
  assert.doesNotThrow(() => assertTransition(TaskState.REVIEWED, TaskState.TESTED));
  assert.throws(() => assertTransition(TaskState.DONE, TaskState.FAILED), /Illegal state transition/);
});

test('pipeline transition helper emits state changes and rejects invalid jumps', async () => {
  const { transition } = await import('./pipeline-context.js');
  const events: string[] = [];
  const emitter = new EventEmitter();
  emitter.on('state:change', (payload: { state: string }) => events.push(payload.state));
  const task = { id: 'task-1', command: 'analyze' as const, target: '.', cwd: '.', createdAt: new Date(), state: TaskState.NEW };

  await transition(task, TaskState.INVESTIGATING, emitter.emit.bind(emitter));
  assert.deepEqual(events, [TaskState.INVESTIGATING]);
  assert.throws(() => assertTransition(task.state, TaskState.DONE), /Illegal state transition/);
});

test('orchestrator analyze and review pipelines use fake provider and clean worktrees', async () => {
  const repo = makeFixtureRepo('aion-pipeline-');
  const fake = makeFakeClaude();
  try {
    initGitRepo(repo);
    await withPath(fake.dir, async () => {
      const orchestrator = new Orchestrator(repo, { budget: 'low' });
      const states: string[] = [];
      const outputs: string[] = [];
      orchestrator.on('state:change', (payload: { state: string }) => states.push(payload.state));
      orchestrator.on('agent:output', (payload: { text: string }) => outputs.push(payload.text));
      orchestrator.on('error', () => undefined);

      const analyze = await orchestrator.runAnalyzePipeline('explain answerQuestion');
      assert.equal(analyze.state, TaskState.REPRODUCED, analyze.errors?.join('\n'));
      assert.match(analyze.plan?.summary ?? '', /low risk/);

      const review = await orchestrator.runReviewPipeline('diff --git a/src/app.ts b/src/app.ts');
      assert.equal(review.state, TaskState.REVIEWED);
      assert.equal(review.review?.approved, true);

      assert.equal(orchestrator.costs.usageAvailable(), true);
      assert.equal(orchestrator.costs.byAgent().some((entry) => entry.agentName === 'planner'), true);
      assert.equal(outputs.some((text) => /tokens:\d+:\d+:\d+:\d+/.test(text)), false);
      assert.equal(states.includes(TaskState.PATCH_CREATED), true);
      assert.equal(existsSync(join(repo, '.worktrees')) ? readdirSync(join(repo, '.worktrees')).length : 0, 0);
    });
  } finally {
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true });
  }
});
