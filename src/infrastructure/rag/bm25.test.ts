import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryBM25Index } from './bm25.js';

test('InMemoryBM25Index: empty index returns no results', () => {
  const idx = new InMemoryBM25Index();
  assert.equal(idx.size(), 0);
  assert.deepEqual(idx.search('anything', 5), []);
});

test('InMemoryBM25Index: ranks exact match higher than partial match', () => {
  const idx = new InMemoryBM25Index();
  idx.add('auth.ts', 'authentication login user authentication password');
  idx.add('utils.ts', 'utility functions for hash and crypto');
  idx.add('api.ts', 'api endpoint for users');

  const results = idx.search('authentication', 5);
  assert.equal(results[0]!.id, 'auth.ts', 'auth.ts should rank first for "authentication"');
  assert.ok(results[0]!.score > 0);
});

test('InMemoryBM25Index: multi-term query aggregates scores', () => {
  const idx = new InMemoryBM25Index();
  idx.add('auth.ts', 'authentication login password');
  idx.add('login.ts', 'login form widget');
  idx.add('other.ts', 'unrelated content here');

  const results = idx.search('authentication login', 5);
  assert.ok(results.length > 0);
  assert.ok(results[0]!.score > 0);
});

test('InMemoryBM25Index: stopwords ignored', () => {
  const idx = new InMemoryBM25Index();
  idx.add('a.ts', 'authentication login');
  const r1 = idx.search('the authentication is', 5);
  const r2 = idx.search('authentication', 5);
  assert.equal(r1[0]?.id, r2[0]?.id);
});

test('InMemoryBM25Index: short tokens ignored', () => {
  const idx = new InMemoryBM25Index();
  idx.add('a.ts', 'authentication login');
  const r = idx.search('a b c authentication', 5);
  assert.equal(r[0]?.id, 'a.ts');
});

test('InMemoryBM25Index: idempotent add', () => {
  const idx = new InMemoryBM25Index();
  idx.add('a.ts', 'authentication login');
  idx.add('a.ts', 'different content');
  assert.equal(idx.size(), 1, 'duplicate id should not be added');
});

test('InMemoryBM25Index: batch add', () => {
  const idx = new InMemoryBM25Index();
  idx.addBatch([
    { id: 'a.ts', text: 'authentication' },
    { id: 'b.ts', text: 'login password' },
    { id: 'c.ts', text: 'unrelated' },
  ]);
  assert.equal(idx.size(), 3);
  const r = idx.search('authentication', 5);
  assert.equal(r[0]?.id, 'a.ts');
});

test('InMemoryBM25Index: respects topK', () => {
  const idx = new InMemoryBM25Index();
  for (let i = 0; i < 20; i++) {
    idx.add(`doc-${i}.ts`, `authentication login password variant-${i}`);
  }
  const r = idx.search('authentication', 5);
  assert.equal(r.length, 5);
});

test('InMemoryBM25Index: scores decay for less relevant docs', () => {
  const idx = new InMemoryBM25Index();
  idx.add('relevant.ts', 'authentication authentication authentication');
  idx.add('partial.ts', 'authentication once');
  idx.add('unrelated.ts', 'completely different content');

  const r = idx.search('authentication', 5);
  assert.equal(r[0]?.id, 'relevant.ts');
  assert.ok(r[0]!.score > (r[1]?.score ?? 0));
  assert.ok((r[1]?.score ?? 0) > (r[2]?.score ?? 0));
});

test('InMemoryBM25Index: toJSON/fromJSON roundtrip', () => {
  const idx1 = new InMemoryBM25Index();
  idx1.add('a.ts', 'authentication login');
  idx1.add('b.ts', 'hash utility');
  const json = idx1.toJSON();
  const idx2 = InMemoryBM25Index.fromJSON(json);
  assert.equal(idx2.size(), 2);
  const r = idx2.search('authentication', 5);
  assert.equal(r[0]?.id, 'a.ts');
});