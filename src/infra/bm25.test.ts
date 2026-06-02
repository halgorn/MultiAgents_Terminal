import test from 'node:test';
import assert from 'node:assert/strict';
import { BM25Index, hybridScore } from './bm25.js';

test('BM25Index prioritizes exact symbol matches', () => {
  const index = new BM25Index();
  index.add('auth', 'function validateToken() { return true; }');
  index.add('billing', 'function createInvoice() { return true; }');

  const results = index.score('validateToken');

  assert.equal(results[0]?.id, 'auth');
  assert.ok((results[0]?.score ?? 0) > (results[1]?.score ?? 0));
});

test('hybridScore combines BM25 and vector scores', () => {
  const results = hybridScore(
    [{ id: 'a', score: 10 }, { id: 'b', score: 1 }],
    [{ id: 'b', score: 1 }, { id: 'c', score: 0.5 }],
    0.5,
  );

  assert.equal(results[0]?.id, 'b');
  assert.deepEqual(new Set(results.map((r) => r.id)), new Set(['a', 'b', 'c']));
});
