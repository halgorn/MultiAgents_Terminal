import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { V1ToV2Migrator, V0ToV1Migrator, MigrationChain, isMigrated, markMigrated } from './migrator.js';

test('V1ToV2Migrator: migrates v1 project.json to v2 manifest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-mig-'));
  try {
    const v1 = {
      schemaVersion: 1,
      generatedAt: '2025-01-01T00:00:00.000Z',
      root: dir,
      repoHash: 'abc',
      files: [{ path: 'a.ts', ext: '.ts', loc: 10, bytes: 100, isTest: false }],
      symbols: [],
      imports: [],
      chunks: [{ file: 'a.ts' }, { file: 'a.ts' }],
      tests: [],
      stats: { files: 1, symbols: 0, imports: 0, chunks: 2, testLinks: 0 },
      embeddings: { provider: 'voyage', model: 'voyage-code-3', dim: 1024, vectorsPath: 'v.bin', count: 2 },
      deps: { nodes: [], edges: [], cycles: [], hotspots: [] },
    };
    writeFileSync(join(dir, 'project.json'), JSON.stringify(v1), 'utf8');
    const mig = new V1ToV2Migrator();
    assert.equal(mig.canHandle(1), true);
    const { manifest } = await mig.migrate(dir);
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.embeddings.providerId, 'voyage');
    assert.equal(manifest.embeddings.dim, 1024);
    assert.equal(manifest.chunkCount, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('V1ToV2Migrator: throws when no project.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-mig-'));
  try {
    const mig = new V1ToV2Migrator();
    await assert.rejects(() => mig.migrate(dir), /no project.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('V1ToV2Migrator: cannot handle v2 (idempotent)', () => {
  const mig = new V1ToV2Migrator();
  assert.equal(mig.canHandle(2), false);
  assert.equal(mig.canHandle(0), false);
});

test('V0ToV1Migrator: migrates legacy repo-index.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-mig-'));
  try {
    const v0 = {
      generatedAt: '2024-01-01T00:00:00.000Z',
      root: dir,
      repoHash: 'old',
      files: [{ path: 'a.ts', ext: '.ts', loc: 5, bytes: 50, isTest: false }],
      symbols: [],
      imports: [],
      chunks: [],
      tests: [],
    };
    writeFileSync(join(dir, 'repo-index.json'), JSON.stringify(v0), 'utf8');
    const mig = new V0ToV1Migrator();
    const result = await mig.migrate(dir);
    assert.equal(result.manifest.schemaVersion, 2);
    assert.equal(result.manifest.fileCount, 1);
    assert.ok(existsSync(join(dir, 'project.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MigrationChain: detects v1 and runs V1ToV2', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-mig-'));
  try {
    const v1 = { schemaVersion: 1, generatedAt: '2025-01-01T00:00:00.000Z', root: dir, repoHash: 'a', files: [], symbols: [], imports: [], chunks: [], tests: [], stats: { files: 0, symbols: 0, imports: 0, chunks: 0, testLinks: 0 }, embeddings: { provider: 'h', model: 'h', dim: 384, vectorsPath: 'v', count: 0 }, deps: { nodes: [], edges: [], cycles: [], hotspots: [] } };
    writeFileSync(join(dir, 'project.json'), JSON.stringify(v1), 'utf8');
    const chain = new MigrationChain();
    const manifest = await chain.runToLatest(dir);
    assert.equal(manifest.schemaVersion, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MigrationChain: detects v2 (no migration needed)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-mig-'));
  try {
    const v2 = {
      schemaVersion: 2,
      generatedAt: '2025-01-01T00:00:00.000Z',
      root: dir,
      repoHash: 'a',
      fileCount: 0,
      chunkCount: 0,
      embeddings: { providerId: 'h', modelId: 'h', dim: 384, indexType: 'flat', vectorsPath: 'v', count: 0 },
    };
    mkdirSync(join(dir, 'pil'), { recursive: true });
    writeFileSync(join(dir, 'pil', 'manifest.json'), JSON.stringify(v2), 'utf8');
    const chain = new MigrationChain();
    const manifest = await chain.runToLatest(dir);
    assert.equal(manifest.schemaVersion, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MigrationChain: throws when no index exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-mig-'));
  try {
    const chain = new MigrationChain();
    await assert.rejects(() => chain.runToLatest(dir), /no PIL\/legacy/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isMigrated / markMigrated: roundtrip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-mig-'));
  try {
    assert.equal(isMigrated(dir, 2), false);
    markMigrated(dir, 2);
    assert.equal(isMigrated(dir, 2), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});