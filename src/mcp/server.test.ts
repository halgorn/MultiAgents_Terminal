
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { maybeResyncOnStale } from './server.js';
import { writeProjectStore } from '../infra/project-store.js';
import { FileWatcher } from './watcher.js';
import { defaultMcpOptions } from './types.js';
import type { ProjectStore } from '../infra/project-store.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-srv-'));
}

function writeFile(p: string, content: string): void {
  const dir = p.substring(0, p.lastIndexOf('/'));
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(p, content);
}

function makeStore(cwd: string, indexedAt: string): ProjectStore {
  return {
    schemaVersion: 1,
    generatedAt: indexedAt,
    root: cwd,
    repoHash: 'abc',
    files: [{ path: 'src/a.ts', ext: '.ts', loc: 5, bytes: 50, isTest: false }],
    symbols: [],
    imports: [],
    chunks: [],
    tests: [],
    embeddings: { model: '', dim: 0, vectorsPath: '', count: 0 },
    deps: { nodes: [], cycles: [], hotspots: [] },
    stats: { files: 1, symbols: 0, imports: 0, chunks: 0, testLinks: 0, vectors: 0, modules: 0, cycles: 0, durationMs: 0 },
  };
}

test('maybeResyncOnStale returns resynced=false when PIL is fresh', async () => {
  const cwd = makeTmp();
  try {
    writeProjectStore(cwd, makeStore(cwd, new Date().toISOString()));
    const options = defaultMcpOptions({ cwd, autoResync: false });
    const result = await maybeResyncOnStale(options);
    assert.equal(result.resynced, false);
    assert.equal(result.confidence, 'high');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('maybeResyncOnStale returns resynced=false when PIL is stale and autoResync=false', async () => {
  const cwd = makeTmp();
  try {
    const old = new Date(Date.now() - 86400 * 1000).toISOString();
    writeProjectStore(cwd, makeStore(cwd, old));
    const options = defaultMcpOptions({ cwd, autoResync: false });
    const result = await maybeResyncOnStale(options);
    assert.equal(result.resynced, false);
    assert.equal(result.confidence, 'stale');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('maybeResyncOnStale returns resynced=false when no PIL exists', async () => {
  const cwd = makeTmp();
  try {
    writeFile(join(cwd, 'package.json'), '{"name":"x"}');
    const options = defaultMcpOptions({ cwd, autoResync: false });
    const result = await maybeResyncOnStale(options);
    assert.equal(result.resynced, false);
    assert.equal(result.confidence, 'stale');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('maybeResyncOnStale triggers sync when autoResync=true and PIL stale', async () => {
  const cwd = makeTmp();
  try {
    writeFile(join(cwd, 'package.json'), '{"name":"x","version":"1"}');
    writeFile(join(cwd, 'tsconfig.json'), '{}');
    writeFile(join(cwd, 'src/a.ts'), 'export const a = 1;\n');
    const old = new Date(Date.now() - 86400 * 1000).toISOString();
    writeProjectStore(cwd, makeStore(cwd, old));
    const options = defaultMcpOptions({ cwd, autoResync: true, skipEmbeddings: true });
    const result = await maybeResyncOnStale(options);
    assert.equal(result.resynced, true);
    assert.equal(result.confidence, 'high');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher detects root file changes (package.json)', async () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'package.json'), '{"name":"x"}');
    const watcher = new FileWatcher({ cwd, roots: ['src'], watchRootFiles: true, debounceMs: 50 });
    let changeFile = '';
    watcher.start();
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(cwd, 'package.json'), '{"name":"y"}');
    await new Promise((r) => setTimeout(r, 200));
    changeFile = 'package.json';
    watcher.stop();
    assert.ok(watcher.filesChanged() >= 1, `expected ≥1 change, got ${watcher.filesChanged()}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
