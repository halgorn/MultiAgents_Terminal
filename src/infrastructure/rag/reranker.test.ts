import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmReranker, createNoopReranker } from './reranker.js';

test('createNoopReranker: returns ids in original order', async () => {
  const rerank = createNoopReranker();
  const out = await rerank('q', [
    { id: 'a.ts', score: 0.5 },
    { id: 'b.ts', score: 0.9 },
  ]);
  assert.deepEqual(out, ['a.ts', 'b.ts']);
});

test('createLlmReranker: parses JSON array from provider response', async () => {
  const rerank = createLlmReranker({
    provider: async () => '["b.ts", "a.ts", "c.ts"]',
  });
  const out = await rerank('query', [
    { id: 'a.ts', score: 0.5 },
    { id: 'b.ts', score: 0.7 },
    { id: 'c.ts', score: 0.6 },
  ]);
  assert.deepEqual(out, ['b.ts', 'a.ts', 'c.ts']);
});

test('createLlmReranker: extracts JSON from prose', async () => {
  const rerank = createLlmReranker({
    provider: async () => 'Here you go:\n["b", "a"]\nDone.',
  });
  const out = await rerank('q', [{ id: 'a', score: 0.1 }, { id: 'b', score: 0.2 }]);
  assert.deepEqual(out, ['b', 'a']);
});

test('createLlmReranker: provider error → falls back to original order', async () => {
  const rerank = createLlmReranker({
    provider: async () => { throw new Error('api down'); },
  });
  const out = await rerank('q', [{ id: 'a', score: 0.5 }]);
  assert.deepEqual(out, ['a']);
});

test('createLlmReranker: malformed JSON → falls back to original order', async () => {
  const rerank = createLlmReranker({
    provider: async () => 'not valid json',
  });
  const out = await rerank('q', [{ id: 'a', score: 0.5 }]);
  assert.deepEqual(out, ['a']);
});

test('createLlmReranker: non-array JSON → falls back to original order', async () => {
  const rerank = createLlmReranker({
    provider: async () => '{"foo": "bar"}',
  });
  const out = await rerank('q', [{ id: 'a', score: 0.5 }]);
  assert.deepEqual(out, ['a']);
});

test('createLlmReranker: respects topN limit', async () => {
  let callPrompt = '';
  const rerank = createLlmReranker({
    provider: async (prompt) => {
      callPrompt = prompt;
      return '[]';
    },
    topN: 2,
  });
  await rerank('q', [
    { id: 'a', score: 0.9 },
    { id: 'b', score: 0.8 },
    { id: 'c', score: 0.7 },
    { id: 'd', score: 0.6 },
  ]);
  const lines = callPrompt.split('\n').filter((l) => l.match(/^\d+\./));
  assert.equal(lines.length, 2);
});

test('createLlmReranker: empty candidates → empty result', async () => {
  const rerank = createLlmReranker({ provider: async () => '[]' });
  const out = await rerank('q', []);
  assert.deepEqual(out, []);
});