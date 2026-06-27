import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EmbeddingCache } from './embedding-cache.js';
import { HashFallbackProvider } from './embeddings/registry.js';

test('EmbeddingCache: first call is a miss', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-cache-'));
  try {
    const cache = new EmbeddingCache(dir, new HashFallbackProvider());
    await cache.embedBatch(['hello']);
    assert.equal(cache.stats().misses, 1);
    assert.equal(cache.stats().hits, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EmbeddingCache: second call with same text is a hit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-cache-'));
  try {
    const cache = new EmbeddingCache(dir, new HashFallbackProvider());
    await cache.embedBatch(['hello']);
    await cache.embedBatch(['hello']);
    const stats = cache.stats();
    assert.equal(stats.misses, 1);
    assert.equal(stats.hits, 1);
    assert.equal(stats.hitRate, 0.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EmbeddingCache: different texts both miss', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-cache-'));
  try {
    const cache = new EmbeddingCache(dir, new HashFallbackProvider());
    await cache.embedBatch(['hello', 'world']);
    assert.equal(cache.stats().misses, 2);
    assert.equal(cache.stats().hits, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EmbeddingCache: mixed batch hits + misses correctly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-cache-'));
  try {
    const cache = new EmbeddingCache(dir, new HashFallbackProvider());
    await cache.embedBatch(['hello']);
    await cache.embedBatch(['hello', 'world']);
    const stats = cache.stats();
    assert.equal(stats.hits, 1, 'hello hit');
    assert.equal(stats.misses, 2, 'hello miss + world miss');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EmbeddingCache: persists to disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-cache-'));
  try {
    const cache1 = new EmbeddingCache(dir, new HashFallbackProvider());
    await cache1.embedBatch(['hello', 'world']);
    assert.ok(existsSync(join(dir, '.ai-runtime', 'pil', 'embed-cache.json')));

    const cache2 = new EmbeddingCache(dir, new HashFallbackProvider());
    await cache2.embedBatch(['hello', 'world']);
    const stats = cache2.stats();
    assert.equal(stats.hits, 2, 'both should hit from disk cache');
    assert.equal(stats.misses, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EmbeddingCache: invalidates when provider changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-cache-'));
  try {
    const cache1 = new EmbeddingCache(dir, new HashFallbackProvider());
    await cache1.embedBatch(['hello']);
    assert.equal(cache1.stats().size, 1);

    const differentProvider = {
      id: 'different',
      model: 'different-model',
      dim: 384,
      isConfigured: () => true,
      async embedBatch(texts: readonly string[]) {
        return texts.map(() => new Float32Array(384));
      },
    };
    const cache2 = new EmbeddingCache(dir, differentProvider);
    await cache2.embedBatch(['hello']);
    assert.equal(cache2.stats().misses, 1, 'different provider should miss');
    assert.equal(cache2.stats().hits, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EmbeddingCache: clear empties cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-cache-'));
  try {
    const cache = new EmbeddingCache(dir, new HashFallbackProvider());
    await cache.embedBatch(['hello', 'world']);
    assert.equal(cache.stats().size, 2);
    cache.clear();
    assert.equal(cache.stats().size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});