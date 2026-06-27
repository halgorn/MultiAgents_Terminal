import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMultiQueryExpander, createHydeExpander, createCombinedExpander } from './query-expander.js';

test('createMultiQueryExpander: parses JSON array from provider', async () => {
  const expander = createMultiQueryExpander({
    provider: async () => '["auth flow", "login flow", "session check"]',
  });
  const out = await expander('authentication');
  assert.equal(out.length, 4);
  assert.equal(out[0], 'authentication');
  assert.ok(out.includes('auth flow'));
});

test('createMultiQueryExpander: returns original on parse failure', async () => {
  const expander = createMultiQueryExpander({
    provider: async () => 'not valid json',
  });
  const out = await expander('authentication');
  assert.deepEqual(out, ['authentication']);
});

test('createMultiQueryExpander: returns original on provider error', async () => {
  const expander = createMultiQueryExpander({
    provider: async () => { throw new Error('api down'); },
  });
  const out = await expander('authentication');
  assert.deepEqual(out, ['authentication']);
});

test('createMultiQueryExpander: limits to numVariants + 1', async () => {
  const expander = createMultiQueryExpander({
    provider: async () => '["a", "b", "c", "d", "e", "f", "g"]',
    numVariants: 3,
  });
  const out = await expander('q');
  assert.equal(out.length, 4);
});

test('createHydeExpander: includes query + hypothetical', async () => {
  const expander = createHydeExpander({
    provider: async () => 'function authenticate(user) { return check(user); }',
  });
  const out = await expander('auth');
  assert.equal(out[0], 'auth');
  assert.match(out[1]!, /function authenticate/);
});

test('createHydeExpander: empty hypothetical → just query', async () => {
  const expander = createHydeExpander({
    provider: async () => '   ',
  });
  const out = await expander('auth');
  assert.deepEqual(out, ['auth']);
});

test('createCombinedExpander: dedupes across expanders', async () => {
  const e1 = createMultiQueryExpander({ provider: async () => '["auth", "login"]' });
  const e2 = createHydeExpander({ provider: async () => 'login function' });
  const combined = createCombinedExpander([e1, e2]);
  const out = await combined('auth');
  assert.ok(out.includes('auth'));
  assert.ok(out.includes('login'));
  assert.equal(out.length, new Set(out).size, 'no duplicates');
});

test('createCombinedExpander: one expander fails → still uses others', async () => {
  const e1 = createMultiQueryExpander({ provider: async () => { throw new Error(); } });
  const e2 = createHydeExpander({ provider: async () => 'auth check' });
  const combined = createCombinedExpander([e1, e2]);
  const out = await combined('auth');
  assert.ok(out.includes('auth'));
  assert.ok(out.includes('auth check'));
});