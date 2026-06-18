import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AI_RUNTIME_DIR } from './paths.js';
import { migrateFromLegacy, needsMigration } from './project-migrate.js';
import { readProjectStore, writeProjectStore, PROJECT_SCHEMA_VERSION } from './project-store.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-mig-'));
}

function makeLegacyRepoIndex(): object {
  return {
    version: 1,
    generatedAt: '2026-06-01T00:00:00.000Z',
    root: '/tmp/x',
    files: [
      { path: 'src/a.ts', ext: '.ts', loc: 10, bytes: 100, isTest: false },
      { path: 'src/b.test.ts', ext: '.ts', loc: 20, bytes: 200, isTest: true },
    ],
    symbols: [{ name: 'foo', kind: 'function', file: 'src/a.ts', line: 1 }],
    imports: [{ from: 'src/a.ts', specifier: './b.js' }],
    chunks: [{ file: 'src/a.ts', name: 'foo', type: 'function', startLine: 1, endLine: 10, tokens: 25 }],
    tests: [{ source: 'src/a.ts', tests: ['src/b.test.ts'] }],
    stats: { files: 2, symbols: 1, imports: 1, chunks: 1, testLinks: 1 },
  };
}

function makeLegacyVectors(): object {
  return {
    version: 1,
    repoHash: 'abc',
    generatedAt: '2026-06-01T00:00:00.000Z',
    embeddingProvider: 'Xenova/all-MiniLM-L6-v2',
    entries: [
      { file: 'src/a.ts', name: 'foo', type: 'function', startLine: 1, endLine: 10, text: 'foo()', vector: [0.1, 0.2, 0.3, 0.4] },
    ],
  };
}

test('migrateFromLegacy returns null when no legacy files', () => {
  const cwd = makeTmp();
  try {
    assert.equal(migrateFromLegacy(cwd), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('migrateFromLegacy reads repo-index.json only', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(makeLegacyRepoIndex()));
    const result = migrateFromLegacy(cwd);
    assert.ok(result);
    assert.equal(result.migratedFrom.repoIndex, true);
    assert.equal(result.migratedFrom.repoVectors, false);
    assert.equal(result.vectorCount, 0);
    assert.equal(result.store.schemaVersion, PROJECT_SCHEMA_VERSION);
    assert.equal(result.store.files.length, 2);
    assert.equal(result.store.embeddings.dim, 0);
    assert.equal(result.store.embeddings.vectorsPath, '');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('migrateFromLegacy reads both repo-index and repo-vectors', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(makeLegacyRepoIndex()));
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-vectors.json'), JSON.stringify(makeLegacyVectors()));
    const result = migrateFromLegacy(cwd);
    assert.ok(result);
    assert.equal(result.migratedFrom.repoVectors, true);
    assert.equal(result.vectorCount, 1);
    assert.equal(result.store.embeddings.dim, 4);
    assert.equal(result.store.embeddings.model, 'Xenova/all-MiniLM-L6-v2');
    assert.equal(result.store.embeddings.vectorsPath, 'project.vectors.bin');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('migrateFromLegacy returns null on corrupted repo-index.json', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), '{ broken');
    assert.equal(migrateFromLegacy(cwd), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('migrateFromLegacy returns null on wrong version', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    const legacy = makeLegacyRepoIndex() as Record<string, unknown>;
    legacy.version = 99;
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(legacy));
    assert.equal(migrateFromLegacy(cwd), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('migrateFromLegacy result is writable by writeProjectStore', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(makeLegacyRepoIndex()));
    const result = migrateFromLegacy(cwd);
    assert.ok(result);
    writeProjectStore(cwd, result.store);
    const reloaded = readProjectStore(cwd);
    assert.ok(reloaded);
    assert.equal(reloaded.files.length, 2);
    assert.equal(reloaded.repoHash, result.store.repoHash);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('needsMigration is true when only legacy exists', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(makeLegacyRepoIndex()));
    assert.equal(needsMigration(cwd), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('needsMigration is false when project.json already exists at current version', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(makeLegacyRepoIndex()));
    const result = migrateFromLegacy(cwd)!;
    writeProjectStore(cwd, result.store);
    assert.equal(needsMigration(cwd), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('needsMigration is false when no legacy files at all', () => {
  const cwd = makeTmp();
  try {
    assert.equal(needsMigration(cwd), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('needsMigration is true when project.json is corrupted', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(makeLegacyRepoIndex()));
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'project.json'), '{ broken');
    assert.equal(needsMigration(cwd), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('needsMigration is true when project.json has wrong schema version', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(makeLegacyRepoIndex()));
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'project.json'), JSON.stringify({ schemaVersion: 99 }));
    assert.equal(needsMigration(cwd), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('migrated store preserves file metadata', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(makeLegacyRepoIndex()));
    const result = migrateFromLegacy(cwd)!;
    const a = result.store.files.find((f) => f.path === 'src/a.ts');
    assert.ok(a);
    assert.equal(a.loc, 10);
    assert.equal(a.bytes, 100);
    assert.equal(a.isTest, false);
    const b = result.store.files.find((f) => f.path === 'src/b.test.ts');
    assert.ok(b);
    assert.equal(b.isTest, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('migrated store stats are populated from legacy', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(makeLegacyRepoIndex()));
    const result = migrateFromLegacy(cwd)!;
    assert.equal(result.store.stats.files, 2);
    assert.equal(result.store.stats.symbols, 1);
    assert.equal(result.store.stats.imports, 1);
    assert.equal(result.store.stats.chunks, 1);
    assert.equal(result.store.stats.testLinks, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('migrated deps are empty (regenerated on next sync)', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(makeLegacyRepoIndex()));
    const result = migrateFromLegacy(cwd)!;
    assert.deepEqual(result.store.deps.nodes, []);
    assert.deepEqual(result.store.deps.cycles, []);
    assert.deepEqual(result.store.deps.hotspots, []);
    assert.equal(result.store.stats.modules, 0);
    assert.equal(result.store.stats.cycles, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('end-to-end: legacy → migrate → write → read roundtrip preserves data', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'), JSON.stringify(makeLegacyRepoIndex()));
    writeFileSync(join(cwd, AI_RUNTIME_DIR, 'repo-vectors.json'), JSON.stringify(makeLegacyVectors()));
    const result = migrateFromLegacy(cwd)!;
    writeProjectStore(cwd, result.store);
    assert.ok(existsSync(join(cwd, AI_RUNTIME_DIR, 'project.json')));
    const reloaded = readProjectStore(cwd)!;
    assert.equal(reloaded.symbols.length, 1);
    assert.equal(reloaded.chunks.length, 1);
    assert.equal(reloaded.embeddings.count, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
