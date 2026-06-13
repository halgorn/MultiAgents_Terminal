import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, assertTransition, STATE_ORDER, TaskState } from './state-machine.js';

// ── canTransition ─────────────────────────────────────────────────────────────

test('canTransition: NEW → INVESTIGATING is allowed', () => {
  assert.ok(canTransition('NEW', 'INVESTIGATING'));
});

test('canTransition: any state → FAILED is allowed', () => {
  const nonTerminal: TaskState[] = ['NEW', 'INVESTIGATING', 'REPRODUCED', 'ROOT_CAUSE_FOUND', 'PATCH_CREATED', 'REVIEWED', 'TESTED', 'VERIFIED'];
  for (const state of nonTerminal) {
    assert.ok(canTransition(state, 'FAILED'), `expected ${state} → FAILED to be allowed`);
  }
});

test('canTransition: happy path chain is fully allowed', () => {
  const chain: TaskState[] = ['NEW', 'INVESTIGATING', 'REPRODUCED', 'ROOT_CAUSE_FOUND', 'PATCH_CREATED', 'REVIEWED', 'TESTED', 'VERIFIED', 'DONE'];
  for (let i = 0; i < chain.length - 1; i++) {
    assert.ok(canTransition(chain[i]!, chain[i + 1]!), `expected ${chain[i]} → ${chain[i + 1]} to be allowed`);
  }
});

test('canTransition: skipping a step is not allowed', () => {
  assert.ok(!canTransition('NEW', 'REPRODUCED'));
  assert.ok(!canTransition('INVESTIGATING', 'PATCH_CREATED'));
});

test('canTransition: backward transition is not allowed', () => {
  assert.ok(!canTransition('REPRODUCED', 'INVESTIGATING'));
  assert.ok(!canTransition('DONE', 'NEW'));
});

test('canTransition: DONE has no allowed transitions', () => {
  const allStates = Object.values(TaskState);
  for (const to of allStates) {
    assert.ok(!canTransition('DONE', to), `expected DONE → ${to} to be rejected`);
  }
});

test('canTransition: FAILED has no allowed transitions', () => {
  const allStates = Object.values(TaskState);
  for (const to of allStates) {
    assert.ok(!canTransition('FAILED', to), `expected FAILED → ${to} to be rejected`);
  }
});

// ── assertTransition ──────────────────────────────────────────────────────────

test('assertTransition: does not throw for valid transition', () => {
  assert.doesNotThrow(() => assertTransition('NEW', 'INVESTIGATING'));
});

test('assertTransition: throws with informative message for invalid transition', () => {
  assert.throws(
    () => assertTransition('NEW', 'DONE'),
    (err) => err instanceof Error && err.message.includes('NEW') && err.message.includes('DONE'),
  );
});

test('assertTransition: throws for DONE → FAILED (terminal state)', () => {
  assert.throws(() => assertTransition('DONE', 'FAILED'));
});

// ── STATE_ORDER ───────────────────────────────────────────────────────────────

test('STATE_ORDER contains all TaskState values', () => {
  const all = new Set(Object.values(TaskState));
  for (const state of STATE_ORDER) {
    all.delete(state);
  }
  assert.equal(all.size, 0, `missing from STATE_ORDER: ${[...all].join(', ')}`);
});

test('STATE_ORDER starts with NEW and ends with FAILED', () => {
  assert.equal(STATE_ORDER[0], 'NEW');
  assert.equal(STATE_ORDER[STATE_ORDER.length - 1], 'FAILED');
});
