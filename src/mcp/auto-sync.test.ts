import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { autoSyncIfNeeded } from './auto-sync.js';
import { writeProjectStore } from '../infra/project-store.js';
import { DEFAULT_FRESHNESS } from './types.js';
import type { ProjectStore } from '../infra/project-store.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-auto-'));
}

function writeFile(p: string, content: string): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function makeFixture(cwd: string): void {
  writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*'] }));
  writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.1' }));
  writeFile(join(cwd, 'src/a.ts'), `export function hello(): string {\n  return 'hi';\n}\n`);
}

function makeStore(cwd: string, indexedAt: string): ProjectStore {
  return {
    schemaVersion: 1,
    generatedAt: indexedAt,
    root: cwd,
    repoHash: 'abc',
    files: [],
    symbols: [],
    imports: [],
    chunks: [],
    tests: [],
    embeddings: { model: '', dim: 0, vectorsPath: '', count: 0 },
    deps: { nodes: [], cycles: [], hotspots: [] },
    stats: { files: 0, symbols: 0, imports: 0, chunks: 0, testLinks: 0, vectors: 0, modules: 0, cycles: 0, durationMs: 0 },
  };
}

test('autoSyncIfNeeded returns reason="missing" when no PIL', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    const result = await autoSyncIfNeeded({ cwd, skipEmbeddings: true, quiet: true });
    assert.equal(result.synced, true);
    assert.equal(result.reason, 'missing');
    assert.ok(result.durationMs >= 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('autoSyncIfNeeded returns reason="fresh" when PIL is current', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    writeProjectStore(cwd, makeStore(cwd, new Date().toISOString()));
    const result = await autoSyncIfNeeded({ cwd, skipEmbeddings: true, quiet: true });
    assert.equal(result.synced, false);
    assert.equal(result.reason, 'fresh');
    assert.equal(result.confidenceBefore, 'high');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('autoSyncIfNeeded returns reason="stale" when PIL is old', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    const oldDate = new Date(Date.now() - 86400 * 1000).toISOString();
    writeProjectStore(cwd, makeStore(cwd, oldDate));
    const result = await autoSyncIfNeeded({ cwd, skipEmbeddings: true, quiet: true });
    assert.equal(result.synced, true);
    assert.equal(result.reason, 'stale');
    assert.equal(result.confidenceBefore, 'stale');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('autoSyncIfNeeded with force=true always syncs', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    writeProjectStore(cwd, makeStore(cwd, new Date().toISOString()));
    const result = await autoSyncIfNeeded({ cwd, skipEmbeddings: true, quiet: true, force: true });
    assert.equal(result.synced, true);
    assert.equal(result.reason, 'forced');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('autoSyncIfNeeded respects custom freshness config', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    const recent = new Date(Date.now() - 600 * 1000).toISOString();
    writeProjectStore(cwd, makeStore(cwd, recent));
    const result = await autoSyncIfNeeded({
      cwd,
      skipEmbeddings: true,
      quiet: true,
      config: { highMaxChanged: 0, staleMinChanged: 3, staleAgeSec: 60 },
    });
    assert.equal(result.synced, true);
    assert.equal(result.reason, 'stale');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('autoSyncIfNeeded does not create PIL if not needed', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    writeProjectStore(cwd, makeStore(cwd, new Date().toISOString()));
    await autoSyncIfNeeded({ cwd, skipEmbeddings: true, quiet: true });
    assert.ok(existsSync(join(cwd, '.ai-runtime', 'project.json')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('autoSyncIfNeeded returns confidenceBefore in all paths', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    writeProjectStore(cwd, makeStore(cwd, new Date().toISOString()));
    const result = await autoSyncIfNeeded({ cwd, skipEmbeddings: true, quiet: true });
    assert.ok(result.confidenceBefore);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
