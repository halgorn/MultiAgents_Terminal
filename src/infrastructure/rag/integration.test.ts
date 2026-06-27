import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FilePilReader, pilSearch, initPilLayout } from './pil-reader.js';
import { FlatVectorIndex } from './vectors/index.js';
import { HashFallbackProvider, EmbeddingRegistry } from './embeddings/registry.js';

test('integration: end-to-end PIL v2 search path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-int-'));
  try {
    initPilLayout(dir);

    const dim = 384;
    const provider = new HashFallbackProvider();
    const chunks = [
      { id: 'src/auth/login.ts:10', text: 'login user authentication' },
      { id: 'src/auth/middleware.ts:25', text: 'middleware auth check' },
      { id: 'src/utils/hash.ts:5', text: 'hash utility function' },
      { id: 'src/api/users.ts:42', text: 'user api endpoint' },
    ];
    const vectors = await provider.embedBatch(chunks.map((c) => c.text));
    const idx = new FlatVectorIndex(dim);
    for (let i = 0; i < chunks.length; i++) {
      idx.insert(chunks[i]!.id, vectors[i]!);
    }
    await idx.persist(join(dir, 'pil/vectors.bin'));

    const manifest = {
      schemaVersion: 2 as const,
      generatedAt: new Date().toISOString(),
      root: dir,
      repoHash: 'integration-test',
      fileCount: 4,
      chunkCount: 4,
      embeddings: {
        providerId: 'hash-fallback',
        modelId: `hash-${dim}`,
        dim,
        indexType: 'flat' as const,
        vectorsPath: 'pil/vectors.bin',
        count: 4,
        norm: 'l2' as const,
      },
    };
    writeFileSync(join(dir, 'pil/manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const reader = new FilePilReader(dir);
    assert.equal(reader.hasManifest(), true);

    const response = await pilSearch(reader, 'authentication login', 3, 'integration-trace-001');
    assert.equal(response.results.length, 3);
    assert.equal(response.meta.traceId, 'integration-trace-001');
    assert.equal(response.meta.pilVersion, 2);
    assert.equal(response.meta.mode, 'hybrid');
    assert.equal(response.meta.confidence, 'high');
    assert.equal(response.meta.indexedAt, manifest.generatedAt);

    for (const r of response.results) {
      assert.ok(r.file.length > 0, 'result must have a file path');
      assert.ok(r.score > 0, 'result must have positive score');
      const [file, lineStr] = r.file.includes(':') && !r.file.startsWith('http')
        ? [r.file.split(':')[0], r.file.split(':')[1] ?? '0']
        : [r.file, '0'];
      assert.ok(typeof file === 'string' && file.length > 0);
      assert.ok(Number(lineStr) >= 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('integration: EmbeddingRegistry swap is reflected in reader', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-int-'));
  try {
    initPilLayout(dir);
    writeFileSync(join(dir, 'pil/manifest.json'), JSON.stringify({
      schemaVersion: 2, generatedAt: new Date().toISOString(), root: dir, repoHash: 'a', fileCount: 0, chunkCount: 0,
      embeddings: { providerId: 'custom', modelId: 'custom-128', dim: 128, indexType: 'flat', vectorsPath: 'v', count: 0 },
    }), 'utf8');

    const customDim = 128;
    const customProvider = {
      id: 'custom-128',
      model: 'custom-128',
      dim: customDim,
      isConfigured: () => true,
      embedBatch: async (texts: readonly string[]) => texts.map((t) => {
        const v = new Float32Array(customDim);
        for (let i = 0; i < customDim; i++) v[i] = (t.charCodeAt(0) + i) % 7 / 7;
        return v;
      }),
    };
    const reg = new EmbeddingRegistry().register({
      id: 'custom-128', envVars: [], priority: 1, factory: () => customProvider,
    });
    const reader = new FilePilReader(dir, reg);

    const idx = new FlatVectorIndex(customDim);
    const v = new Float32Array(customDim).fill(0.5);
    idx.insert('test.ts:1', v);
    await idx.persist(join(dir, 'pil/vectors.bin'));

    const response = await pilSearch(reader, 'hello', 3, 'trace-2');
    assert.equal(response.meta.pilVersion, 2);
    assert.equal(response.results.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('integration: graceful empty-state behavior', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-int-'));
  try {
    const reader = new FilePilReader(dir);
    assert.equal(reader.hasManifest(), false);

    const response = await pilSearch(reader, 'anything', 5, 'trace-3');
    assert.equal(response.results.length, 0);
    assert.match(response.note ?? '', /aion sync/);
    assert.equal(response.meta.confidence, 'stale');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('integration: multiple search calls reuse loaded index', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-int-'));
  try {
    initPilLayout(dir);
    const dim = 384;
    const provider = new HashFallbackProvider();
    const vecs = await provider.embedBatch(['alpha', 'beta', 'gamma']);
    const idx = new FlatVectorIndex(dim);
    idx.insert('a.ts:1', vecs[0]!);
    idx.insert('b.ts:1', vecs[1]!);
    idx.insert('c.ts:1', vecs[2]!);
    await idx.persist(join(dir, 'pil/vectors.bin'));
    writeFileSync(join(dir, 'pil/manifest.json'), JSON.stringify({
      schemaVersion: 2, generatedAt: new Date().toISOString(), root: dir, repoHash: 'a', fileCount: 3, chunkCount: 3,
      embeddings: { providerId: 'hash', modelId: 'hash-384', dim, indexType: 'flat', vectorsPath: 'v', count: 3 },
    }), 'utf8');

    const reader = new FilePilReader(dir);
    const r1 = await pilSearch(reader, 'alpha', 3, 't1');
    const r2 = await pilSearch(reader, 'beta', 3, 't2');
    const r3 = await pilSearch(reader, 'gamma', 3, 't3');

    assert.equal(r1.meta.traceId, 't1');
    assert.equal(r2.meta.traceId, 't2');
    assert.equal(r3.meta.traceId, 't3');
    assert.ok(r1.results.length > 0);
    assert.ok(r2.results.length > 0);
    assert.ok(r3.results.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});