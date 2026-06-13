import test from 'node:test';
import assert from 'node:assert/strict';
import { rerankLocal, rerankWithLLM, setRerankerClientFactoryForTest } from './reranker.js';
import type { RerankCandidate } from './reranker.js';

const CANDIDATES: RerankCandidate[] = [
  { id: 'a', content: 'function authenticate user login password' },
  { id: 'b', content: 'class DatabaseConnection pooling retry logic' },
  { id: 'c', content: 'const login = () => validateUser(password)' },
];

// ── rerankLocal ───────────────────────────────────────────────────────────────

test('rerankLocal: returns at most topK results', () => {
  const results = rerankLocal('login', CANDIDATES, 2);
  assert.equal(results.length, 2);
});

test('rerankLocal: ranks most-matching candidates first', () => {
  const results = rerankLocal('login password', CANDIDATES, 3);
  // 'a' matches both 'login' and 'password'; 'c' matches 'login' and 'password'
  // 'b' matches neither
  const ranked = results.map((r) => r.id);
  assert.ok(!ranked[0]!.includes('b') || ranked.indexOf('b') > ranked.indexOf('a'), 'b should rank below login-related docs');
});

test('rerankLocal: empty candidates returns empty array', () => {
  assert.deepEqual(rerankLocal('query', [], 5), []);
});

test('rerankLocal: result rank is 0-indexed by result position', () => {
  const results = rerankLocal('login', CANDIDATES, 3);
  for (let i = 0; i < results.length; i++) {
    assert.equal(results[i]!.rank, i);
  }
});

test('rerankLocal: topK larger than candidates returns all candidates', () => {
  const results = rerankLocal('query', CANDIDATES, 100);
  assert.equal(results.length, CANDIDATES.length);
});

test('rerankLocal: zero-match query preserves original order', () => {
  const results = rerankLocal('xxxxxxxxxxxxxxx', CANDIDATES, 3);
  assert.deepEqual(results.map((r) => r.id), ['a', 'b', 'c']);
});

// ── rerankWithLLM ─────────────────────────────────────────────────────────────

test('rerankWithLLM: single candidate returns it without calling LLM', async () => {
  let called = false;
  setRerankerClientFactoryForTest(() => ({
    messages: {
      create: async () => { called = true; return { content: [] }; },
    } as never,
  }));
  try {
    const results = await rerankWithLLM('query', [{ id: 'x', content: 'hello' }], 5);
    assert.equal(called, false, 'LLM should not be called for single candidate');
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, 'x');
  } finally {
    setRerankerClientFactoryForTest(null);
  }
});

function withFakeKey<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  return fn().finally(() => {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  });
}

test('rerankWithLLM: uses LLM ranking when response is valid JSON array', async () => {
  setRerankerClientFactoryForTest(() => ({
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: '[3, 1, 2]' }],
      }),
    } as never,
  }));
  try {
    const results = await withFakeKey(() => rerankWithLLM('login', CANDIDATES, 3));
    assert.equal(results[0]!.id, 'c', 'rank 3 → index 2 → id "c"');
    assert.equal(results[1]!.id, 'a', 'rank 1 → index 0 → id "a"');
    assert.equal(results[2]!.id, 'b', 'rank 2 → index 1 → id "b"');
  } finally {
    setRerankerClientFactoryForTest(null);
  }
});

test('rerankWithLLM: falls back to original order when LLM returns no JSON array', async () => {
  setRerankerClientFactoryForTest(() => ({
    messages: {
      create: async () => ({ content: [{ type: 'text', text: 'I cannot rank these.' }] }),
    } as never,
  }));
  try {
    const results = await withFakeKey(() => rerankWithLLM('login', CANDIDATES, 3));
    assert.deepEqual(results.map((r) => r.id), ['a', 'b', 'c']);
  } finally {
    setRerankerClientFactoryForTest(null);
  }
});

test('rerankWithLLM: falls back when LLM throws', async () => {
  setRerankerClientFactoryForTest(() => ({
    messages: {
      create: async () => { throw new Error('network timeout'); },
    } as never,
  }));
  try {
    const results = await withFakeKey(() => rerankWithLLM('login', CANDIDATES, 3));
    assert.deepEqual(results.map((r) => r.id), ['a', 'b', 'c']);
  } finally {
    setRerankerClientFactoryForTest(null);
  }
});

test('rerankWithLLM: respects topK limit from LLM response', async () => {
  setRerankerClientFactoryForTest(() => ({
    messages: {
      create: async () => ({ content: [{ type: 'text', text: '[1, 2, 3]' }] }),
    } as never,
  }));
  try {
    const results = await withFakeKey(() => rerankWithLLM('login', CANDIDATES, 2));
    assert.equal(results.length, 2);
  } finally {
    setRerankerClientFactoryForTest(null);
  }
});

test('rerankWithLLM: out-of-bounds ranks in LLM response are filtered', async () => {
  setRerankerClientFactoryForTest(() => ({
    messages: {
      create: async () => ({ content: [{ type: 'text', text: '[99, 1, 2]' }] }),
    } as never,
  }));
  try {
    const results = await withFakeKey(() => rerankWithLLM('login', CANDIDATES, 3));
    const ids = results.map((r) => r.id);
    assert.ok(!ids.includes(undefined as never), 'out-of-bounds rank should be filtered');
  } finally {
    setRerankerClientFactoryForTest(null);
  }
});
