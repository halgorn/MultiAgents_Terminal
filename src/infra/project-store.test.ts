import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  PROJECT_SCHEMA_VERSION,
  computeRepoHash,
  isProjectStoreFresh,
  projectStorePath,
  projectVectorsPath,
  readProjectStore,
  readVectors,
  writeProjectStore,
  writeVectors,
  type ProjectStore,
} from './project-store.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-pstore-'));
}

function makeStore(overrides: Partial<ProjectStore> = {}): ProjectStore {
  const base: ProjectStore = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    root: '/tmp/x',
    repoHash: 'abc',
    files: [{ path: 'src/a.ts', ext: '.ts', loc: 10, bytes: 100, isTest: false }],
    symbols: [],
    imports: [],
    chunks: [],
    tests: [],
    embeddings: { model: 'Xenova/all-MiniLM-L6-v2', dim: 384, vectorsPath: 'project.vectors.bin', count: 0 },
    deps: { nodes: [], cycles: [], hotspots: [] },
    stats: {
      files: 1, symbols: 0, imports: 0, chunks: 0, testLinks: 0,
      vectors: 0, modules: 0, cycles: 0, durationMs: 1,
    },
  };
  return { ...base, ...overrides };
}

test('computeRepoHash is deterministic and order-independent', () => {
  const a = computeRepoHash([{ path: 'a.ts', bytes: 1, loc: 1 }, { path: 'b.ts', bytes: 2, loc: 2 }]);
  const b = computeRepoHash([{ path: 'b.ts', bytes: 2, loc: 2 }, { path: 'a.ts', bytes: 1, loc: 1 }]);
  assert.equal(a, b);
  assert.equal(a.length, 40);
});

test('computeRepoHash changes when content size changes', () => {
  const a = computeRepoHash([{ path: 'a.ts', bytes: 1, loc: 1 }]);
  const b = computeRepoHash([{ path: 'a.ts', bytes: 2, loc: 1 }]);
  assert.notEqual(a, b);
});

test('writeProjectStore + readProjectStore roundtrip', () => {
  const cwd = makeTmp();
  try {
    const store = makeStore({ repoHash: 'deadbeef' });
    writeProjectStore(cwd, store);
    const loaded = readProjectStore(cwd);
    assert.ok(loaded);
    assert.equal(loaded.repoHash, 'deadbeef');
    assert.equal(loaded.schemaVersion, PROJECT_SCHEMA_VERSION);
    assert.equal(loaded.files.length, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readProjectStore returns null when file missing', () => {
  const cwd = makeTmp();
  assert.equal(readProjectStore(cwd), null);
});

test('readProjectStore returns null on schema mismatch', () => {
  const cwd = makeTmp();
  try {
    const path = projectStorePath(cwd);
    mkdirSync(join(cwd, '.ai-runtime'), { recursive: true });
    writeFileSync(path, JSON.stringify({ schemaVersion: 99, generatedAt: '', root: '', repoHash: '', files: [], symbols: [], imports: [], chunks: [], tests: [], embeddings: { model: '', dim: 0, vectorsPath: '', count: 0 }, deps: { nodes: [], cycles: [], hotspots: [] }, stats: { files: 0, symbols: 0, imports: 0, chunks: 0, testLinks: 0, vectors: 0, modules: 0, cycles: 0, durationMs: 0 } }));
    assert.equal(readProjectStore(cwd), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readProjectStore returns null on corrupted JSON', () => {
  const cwd = makeTmp();
  try {
    const path = projectStorePath(cwd);
    mkdirSync(join(cwd, '.ai-runtime'), { recursive: true });
    writeFileSync(path, '{ not json');
    assert.equal(readProjectStore(cwd), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeVectors + readVectors roundtrip', () => {
  const cwd = makeTmp();
  try {
    const floats = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    writeVectors(cwd, floats, 3);
    const loaded = readVectors(cwd);
    assert.ok(loaded);
    assert.equal(loaded.length, 6);
    assert.equal(loaded[0], 1.0);
    assert.equal(loaded[5], 6.0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readVectors returns null when file missing', () => {
  const cwd = makeTmp();
  assert.equal(readVectors(cwd), null);
});

test('readVectors returns null on empty file', () => {
  const cwd = makeTmp();
  try {
    const path = projectVectorsPath(cwd);
    mkdirSync(join(cwd, '.ai-runtime'), { recursive: true });
    writeFileSync(path, Buffer.alloc(0));
    assert.equal(readVectors(cwd), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readVectors returns null when buffer length is not a multiple of float32 size', () => {
  const cwd = makeTmp();
  try {
    const path = projectVectorsPath(cwd);
    mkdirSync(join(cwd, '.ai-runtime'), { recursive: true });
    writeFileSync(path, Buffer.from([1, 2, 3]));
    assert.equal(readVectors(cwd), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('isProjectStoreFresh returns false when no store', () => {
  const cwd = makeTmp();
  assert.equal(isProjectStoreFresh(cwd, [{ path: 'a', bytes: 1, loc: 1 }]), false);
});

test('isProjectStoreFresh returns true when hash matches', () => {
  const cwd = makeTmp();
  try {
    const files = [{ path: 'a', bytes: 1, loc: 1 }];
    const hash = computeRepoHash(files);
    writeProjectStore(cwd, makeStore({ repoHash: hash }));
    assert.equal(isProjectStoreFresh(cwd, files), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('isProjectStoreFresh returns false when hash diverges', () => {
  const cwd = makeTmp();
  try {
    writeProjectStore(cwd, makeStore({ repoHash: 'old' }));
    assert.equal(isProjectStoreFresh(cwd, [{ path: 'a', bytes: 1, loc: 1 }]), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('schemaVersion constant equals 1', () => {
  assert.equal(PROJECT_SCHEMA_VERSION, 1);
});

test('vectors file path is relative to runtime dir', () => {
  assert.match(projectVectorsPath('/x'), /\.ai-runtime[\\\/]project\.vectors\.bin$/);
});

test('project file path is relative to runtime dir', () => {
  assert.match(projectStorePath('/x'), /\.ai-runtime[\\\/]project\.json$/);
});

test('writeProjectStore creates .ai-runtime directory if missing', () => {
  const cwd = makeTmp();
  try {
    assert.equal(existsSync(join(cwd, '.ai-runtime')), false);
    writeProjectStore(cwd, makeStore());
    assert.equal(existsSync(join(cwd, '.ai-runtime')), true);
    assert.equal(existsSync(projectStorePath(cwd)), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('large vector buffer roundtrip preserves all values', () => {
  const cwd = makeTmp();
  try {
    const n = 1000;
    const floats = new Float32Array(n);
    for (let i = 0; i < n; i++) floats[i] = Math.sin(i) * 100;
    writeVectors(cwd, floats, 384);
    const loaded = readVectors(cwd);
    assert.ok(loaded);
    assert.equal(loaded.length, n);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(loaded[i] - floats[i]) < 1e-5);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('JSON output is human-readable (pretty-printed)', () => {
  const cwd = makeTmp();
  try {
    writeProjectStore(cwd, makeStore());
    const raw = readFileSync(projectStorePath(cwd), 'utf8');
    assert.ok(raw.includes('\n  '), 'expected indentation');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
