import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FilePilReader, pilSearch, initPilLayout, resetPil } from './pil-reader.js';
import { FlatVectorIndex } from './vectors/index.js';
import { HashFallbackProvider, type EmbeddingRegistry } from './embeddings/registry.js';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'aion-pil-'));
}

function writeManifest(dir: string, dim: number, count = 0): void {
  initPilLayout(dir);
  writeFileSync(join(dir, '.ai-runtime/pil/manifest.json'), JSON.stringify({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    root: dir,
    repoHash: 'a',
    fileCount: 0,
    chunkCount: 0,
    embeddings: { providerId: 'hash', modelId: `hash-${dim}`, dim, indexType: 'flat', vectorsPath: 'v', count },
  }), 'utf8');
}

test('FilePilReader: hasManifest returns false when missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-pil-'));
  try {
    const reader = new FilePilReader(dir);
    assert.equal(reader.hasManifest(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FilePilReader: hasManifest returns true after init', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-pil-'));
  try {
    initPilLayout(dir);
    writeFileSync(join(dir, '.ai-runtime/pil/manifest.json'), JSON.stringify({
      schemaVersion: 2, generatedAt: new Date().toISOString(), root: dir, repoHash: 'a', fileCount: 0, chunkCount: 0,
      embeddings: { providerId: 'hash', modelId: 'hash', dim: 4, indexType: 'flat', vectorsPath: 'v', count: 0 },
    }), 'utf8');
    const reader = new FilePilReader(dir);
    assert.equal(reader.hasManifest(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FilePilReader: readManifest returns null for corrupt JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-pil-'));
  try {
    initPilLayout(dir);
    writeFileSync(join(dir, '.ai-runtime/pil/manifest.json'), '{ broken', 'utf8');
    const reader = new FilePilReader(dir);
    assert.equal(reader.readManifest(), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FilePilReader: loadVectorIndex returns empty index when no vectors.bin', async () => {
  const dir = freshDir();
  try {
    writeManifest(dir, 4);
    const reader = new FilePilReader(dir);
    const idx = await reader.loadVectorIndex();
    assert.equal(idx.size(), 0);
    assert.equal(idx.dim, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FilePilReader: loadVectorIndex reads existing vectors.bin', async () => {
  const dir = freshDir();
  try {
    writeManifest(dir, 4, 1);
    const idx = new FlatVectorIndex(4);
    idx.insert('a.ts:10', new Float32Array([1, 0, 0, 0]));
    await idx.persist(join(dir, '.ai-runtime/pil/vectors.bin'));
    const reader = new FilePilReader(dir);
    const loaded = await reader.loadVectorIndex();
    assert.equal(loaded.size(), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pilSearch: returns helpful note when no manifest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-pil-'));
  try {
    const reader = new FilePilReader(dir);
    const result = await pilSearch(reader, 'hello', 5, 'trace-1');
    assert.equal(result.results.length, 0);
    assert.match(result.note ?? '', /aion sync/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pilSearch: returns meta with traceId and pilVersion', async () => {
  const dir = freshDir();
  try {
    initPilLayout(dir);
    writeFileSync(join(dir, '.ai-runtime/pil/manifest.json'), JSON.stringify({
      schemaVersion: 2, generatedAt: '2025-06-01T00:00:00.000Z', root: dir, repoHash: 'a', fileCount: 5, chunkCount: 0,
      embeddings: { providerId: 'hash', modelId: 'hash-384', dim: 384, indexType: 'flat', vectorsPath: 'v', count: 0 },
    }), 'utf8');
    const reader = new FilePilReader(dir);
    const result = await pilSearch(reader, 'hello', 5, 'trace-99');
    assert.equal(result.meta.traceId, 'trace-99');
    assert.equal(result.meta.pilVersion, 2);
    assert.equal(result.meta.indexedAt, '2025-06-01T00:00:00.000Z');
    assert.equal(result.meta.mode, 'hybrid');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pilSearch: parses file:line from chunk id', async () => {
  const dir = freshDir();
  try {
    initPilLayout(dir);
    writeFileSync(join(dir, '.ai-runtime/pil/manifest.json'), JSON.stringify({
      schemaVersion: 2, generatedAt: new Date().toISOString(), root: dir, repoHash: 'a', fileCount: 1, chunkCount: 1,
      embeddings: { providerId: 'hash', modelId: 'hash-384', dim: 384, indexType: 'flat', vectorsPath: 'v', count: 1 },
    }), 'utf8');
    const idx = new FlatVectorIndex(384);
    idx.insert('src/foo.ts:42', new Float32Array(384).fill(1));
    await idx.persist(join(dir, '.ai-runtime/pil/vectors.bin'));
    const reader = new FilePilReader(dir);
    const result = await pilSearch(reader, 'foo', 5, 'trace');
    assert.equal(result.results[0]?.file, 'src/foo.ts');
    assert.equal(result.results[0]?.startLine, 42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('initPilLayout + resetPil: roundtrip', () => {
  const dir = freshDir();
  try {
    initPilLayout(dir);
    assert.ok(existsSync(join(dir, '.ai-runtime', 'pil')));
    resetPil(dir);
    assert.ok(!existsSync(join(dir, '.ai-runtime', 'pil')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});