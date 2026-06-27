import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddingRegistry, HashFallbackProvider, type EmbeddingProvider } from './registry.js';

test('EmbeddingRegistry: register and resolve by id', () => {
  const reg = new EmbeddingRegistry();
  const fake: EmbeddingProvider = {
    id: 'test', model: 'test-model', dim: 8,
    isConfigured: () => true,
    async embedBatch(texts) { return texts.map(() => new Float32Array(8)); },
  };
  reg.register({ id: 'test', envVars: [], factory: () => fake, priority: 1 });
  const p = reg.resolve('test');
  assert.equal(p.id, 'test');
  assert.equal(p.dim, 8);
});

test('EmbeddingRegistry: throws on duplicate id', () => {
  const reg = new EmbeddingRegistry();
  reg.register({ id: 'x', envVars: [], factory: () => null, priority: 1 });
  assert.throws(() => reg.register({ id: 'x', envVars: [], factory: () => null, priority: 2 }));
});

test('EmbeddingRegistry: resolves first configured by priority', () => {
  const reg = new EmbeddingRegistry();
  const a: EmbeddingProvider = { id: 'a', model: 'a', dim: 4, isConfigured: () => false, async embedBatch() { return []; } };
  const b: EmbeddingProvider = { id: 'b', model: 'b', dim: 4, isConfigured: () => true, async embedBatch() { return []; } };
  reg.register({ id: 'a', envVars: ['A_KEY'], factory: () => a, priority: 1 });
  reg.register({ id: 'b', envVars: ['B_KEY'], factory: () => b, priority: 2 });
  const p = reg.resolve();
  assert.equal(p.id, 'b');
});

test('EmbeddingRegistry: throws when no provider configured', () => {
  const reg = new EmbeddingRegistry();
  reg.register({ id: 'a', envVars: ['A_KEY'], factory: () => null, priority: 1 });
  assert.throws(() => reg.resolve(), /no configured provider/);
});

test('EmbeddingRegistry: configured() returns only available', () => {
  const reg = new EmbeddingRegistry();
  const a: EmbeddingProvider = { id: 'a', model: 'a', dim: 4, isConfigured: () => false, async embedBatch() { return []; } };
  const b: EmbeddingProvider = { id: 'b', model: 'b', dim: 4, isConfigured: () => true, async embedBatch() { return []; } };
  reg.register({ id: 'a', envVars: [], factory: () => a, priority: 1 });
  reg.register({ id: 'b', envVars: [], factory: () => b, priority: 2 });
  const configured = reg.configured();
  assert.equal(configured.length, 1);
  assert.equal(configured[0]!.id, 'b');
});

test('HashFallbackProvider: always configured', () => {
  const p = new HashFallbackProvider();
  assert.equal(p.isConfigured(), true);
});

test('HashFallbackProvider: embeds to fixed dim', async () => {
  const p = new HashFallbackProvider();
  const vecs = await p.embedBatch(['hello', 'world']);
  assert.equal(vecs.length, 2);
  assert.equal(vecs[0]!.length, p.dim);
});

test('HashFallbackProvider: deterministic embeddings', async () => {
  const p = new HashFallbackProvider();
  const v1 = (await p.embedBatch(['hello']))[0]!;
  const v2 = (await p.embedBatch(['hello']))[0]!;
  assert.deepEqual(Array.from(v1), Array.from(v2));
});

test('HashFallbackProvider: different inputs → different embeddings', async () => {
  const p = new HashFallbackProvider();
  const vecs = await p.embedBatch(['hello', 'world']);
  const same = Array.from(vecs[0]!).every((v, i) => Math.abs(v - Array.from(vecs[1]!)[i]!) < 0.001);
  assert.equal(same, false);
});