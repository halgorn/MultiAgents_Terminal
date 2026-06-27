import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, reciprocalRankFusion } from './query.js';
import type { RagEngine, BM25IndexLike } from './query.js';
import type { PilManifest } from './manifest.js';
import type { VectorIndex, ScoredId } from './vectors/index.js';

function makeEngine(bm25Hits: Array<[string, number]>, vectorHits: Array<[string, number]>, queryEmbed: Float32Array): RagEngine {
  const manifest: PilManifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    root: '/tmp',
    repoHash: 'abc',
    fileCount: 10,
    chunkCount: 50,
    embeddings: {
      providerId: 'test',
      modelId: 'test',
      dim: 4,
      indexType: 'flat',
      vectorsPath: 'v.bin',
      count: vectorHits.length,
    },
  };
  const vidx: VectorIndex = {
    type: 'flat',
    dim: 4,
    size: () => vectorHits.length,
    insert: () => {},
    search: (_q, k) => vectorHits.slice(0, k).map(([id, score]) => ({ id, score })),
    persist: async () => {},
    load: async () => {},
  };
  const bm25: BM25IndexLike = {
    search: (_text, k) => bm25Hits.slice(0, k).map(([id, score]) => ({ id, score })),
  };
  return {
    manifest: () => manifest,
    vectorIndex: () => vidx,
    bm25: () => bm25,
    embed: async () => queryEmbed,
  };
}

test('query: hybrid mode fuses BM25 + vector', async () => {
  const engine = makeEngine(
    [['a', 1.0], ['b', 0.5]],
    [['c', 0.9], ['a', 0.7]],
    new Float32Array([1, 0, 0, 0]),
  );
  const result = await query(engine, { text: 'foo', topK: 5 }, 'trace-1');
  assert.ok(result.hits.length > 0);
  assert.ok(result.hits.some((h) => h.id === 'a'), 'a should be in results (appears in both)');
});

test('query: vector-only mode skips BM25', async () => {
  const engine = makeEngine(
    [['b', 1.0]],
    [['a', 0.9]],
    new Float32Array([1, 0, 0, 0]),
  );
  const result = await query(engine, { text: 'foo', mode: 'vector' }, 't');
  assert.equal(result.meta.mode, 'vector');
  assert.ok(result.hits.some((h) => h.id === 'a'));
  assert.ok(!result.hits.some((h) => h.id === 'b'));
});

test('query: bm25-only mode skips vector', async () => {
  const engine = makeEngine(
    [['a', 1.0]],
    [['b', 0.9]],
    new Float32Array([1, 0, 0, 0]),
  );
  const result = await query(engine, { text: 'foo', mode: 'bm25' }, 't');
  assert.equal(result.meta.mode, 'bm25');
  assert.ok(result.hits.some((h) => h.id === 'a'));
  assert.ok(!result.hits.some((h) => h.id === 'b'));
});

test('query: returns metadata with manifest fields', async () => {
  const engine = makeEngine([], [], new Float32Array([0, 0, 0, 0]));
  const result = await query(engine, { text: 'foo' }, 'trace-xyz');
  assert.equal(result.meta.pilVersion, 2);
  assert.equal(result.meta.traceId, 'trace-xyz');
  assert.equal(result.meta.mode, 'hybrid');
  assert.match(result.meta.indexedAt, /^\d{4}-\d{2}-\d{2}/);
});

test('query: respects topK', async () => {
  const engine = makeEngine(
    Array.from({ length: 100 }, (_, i) => [`id-${i}`, 1.0 - i * 0.01] as [string, number]),
    Array.from({ length: 100 }, (_, i) => [`id-${i}`, 1.0 - i * 0.01] as [string, number]),
    new Float32Array([1, 0, 0, 0]),
  );
  const result = await query(engine, { text: 'foo', topK: 5 });
  assert.equal(result.hits.length, 5);
});

test('reciprocalRankFusion: combines overlapping results', () => {
  const fused = reciprocalRankFusion(
    [{ id: 'a', score: 1 }, { id: 'b', score: 0.5 }, { id: 'c', score: 0.1 }],
    [{ id: 'a', score: 0.9 }, { id: 'd', score: 0.8 }, { id: 'b', score: 0.7 }],
  );
  assert.ok(fused.length >= 4);
  const a = fused.find((x) => x.id === 'a')!;
  const b = fused.find((x) => x.id === 'b')!;
  assert.ok(a.fusedScore > 0);
  assert.ok(b.fusedScore > 0);
  assert.equal(a.bm25Score, 1);
  assert.equal(a.vectorScore, 0.9);
});

test('reciprocalRankFusion: empty inputs return empty', () => {
  assert.deepEqual(reciprocalRankFusion([], []), []);
});

test('reciprocalRankFusion: ranks results by fused score', () => {
  const fused = reciprocalRankFusion(
    [{ id: 'x', score: 1 }, { id: 'y', score: 0.5 }],
    [{ id: 'y', score: 1 }, { id: 'z', score: 0.5 }],
  );
  assert.equal(fused[0]!.id, 'y', 'y appears in both → highest fused');
});