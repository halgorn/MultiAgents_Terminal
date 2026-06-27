import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PilManifestSchema, PIL_V1_LEGACY_KEYS } from './manifest.js';

test('PilManifestSchema: accepts minimal valid manifest', () => {
  const m = {
    schemaVersion: 2 as const,
    generatedAt: new Date().toISOString(),
    root: '/tmp/proj',
    repoHash: 'abc123',
    fileCount: 100,
    chunkCount: 500,
    embeddings: {
      providerId: 'voyage-code-3',
      modelId: 'voyage-code-3',
      dim: 1024,
      indexType: 'flat' as const,
      vectorsPath: 'vectors.bin',
      count: 500,
    },
  };
  const result = PilManifestSchema.safeParse(m);
  assert.equal(result.success, true);
});

test('PilManifestSchema: rejects schemaVersion != 2', () => {
  const m = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: '/tmp/proj',
    repoHash: 'abc',
    fileCount: 0,
    chunkCount: 0,
    embeddings: {
      providerId: 'hash',
      modelId: 'hash-384',
      dim: 384,
      indexType: 'flat' as const,
      vectorsPath: 'v.bin',
      count: 0,
    },
  };
  const result = PilManifestSchema.safeParse(m);
  assert.equal(result.success, false);
});

test('PilManifestSchema: rejects invalid indexType', () => {
  const m = {
    schemaVersion: 2 as const,
    generatedAt: new Date().toISOString(),
    root: '/tmp/proj',
    repoHash: 'abc',
    fileCount: 0,
    chunkCount: 0,
    embeddings: {
      providerId: 'hash',
      modelId: 'hash',
      dim: 384,
      indexType: 'invalid',
      vectorsPath: 'v.bin',
      count: 0,
    },
  };
  const result = PilManifestSchema.safeParse(m);
  assert.equal(result.success, false);
});

test('PilManifestSchema: requires positive dim', () => {
  const m = {
    schemaVersion: 2 as const,
    generatedAt: new Date().toISOString(),
    root: '/tmp/proj',
    repoHash: 'abc',
    fileCount: 0,
    chunkCount: 0,
    embeddings: {
      providerId: 'hash',
      modelId: 'hash',
      dim: 0,
      indexType: 'flat' as const,
      vectorsPath: 'v.bin',
      count: 0,
    },
  };
  const result = PilManifestSchema.safeParse(m);
  assert.equal(result.success, false);
});

test('PilManifestSchema: accepts full manifest with all fields', () => {
  const m = {
    schemaVersion: 2 as const,
    generatedAt: new Date().toISOString(),
    root: '/tmp/proj',
    repoHash: 'abc',
    fileCount: 100,
    chunkCount: 500,
    embeddings: {
      providerId: 'voyage-code-3',
      modelId: 'voyage-code-3',
      dim: 1024,
      indexType: 'hnsw' as const,
      vectorsPath: 'vectors.bin',
      count: 500,
      norm: 'l2' as const,
    },
    bm25: { terms: 1000, docs: 500, path: 'bm25.bin' },
    chunker: { parser: 'tree-sitter-typescript', version: '0.23.2' },
    languageProfile: 'typescript' as const,
  };
  const result = PilManifestSchema.safeParse(m);
  assert.equal(result.success, true);
});

test('PIL_V1_LEGACY_KEYS: lists all v1 schema keys', () => {
  assert.ok(PIL_V1_LEGACY_KEYS.includes('schemaVersion'));
  assert.ok(PIL_V1_LEGACY_KEYS.includes('embeddings'));
  assert.ok(PIL_V1_LEGACY_KEYS.includes('chunks'));
  assert.ok(PIL_V1_LEGACY_KEYS.includes('deps'));
});