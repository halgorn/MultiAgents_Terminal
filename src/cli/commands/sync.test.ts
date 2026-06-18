import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runSync } from './sync.js';
import { readProjectStore, projectStorePath, projectVectorsPath } from '../../infra/project-store.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-sync-'));
}

function writeFile(p: string, content: string): void {
  const dir = p.substring(0, p.lastIndexOf('/'));
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(p, content);
}

function makeFixture(cwd: string): void {
  writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*'] }));
  writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.1' }));
  writeFile(join(cwd, 'src/a.ts'),
    `export function hello(): string {\n  const greeting = 'hi';\n  return greeting;\n}\n`);
  writeFile(join(cwd, 'src/b.ts'),
    `import { hello } from './a.js';\nexport function greet(): string {\n  const out = hello() + '!';\n  return out;\n}\n`);
  writeFile(join(cwd, 'src/c.test.ts'),
    `import { hello } from './a.js';\ntest('hello works', () => {\n  const result = hello();\n  if (!result) throw new Error('empty');\n});\n`);
}

test('runSync produces project.json in tmp dir', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    const result = await runSync(cwd, { skipEmbeddings: true, quiet: true });
    assert.ok(result);
    assert.ok(existsSync(projectStorePath(cwd)));
    const store = readProjectStore(cwd);
    assert.ok(store);
    assert.ok(store.files.length >= 3, `expected >=3 files, got ${store.files.length}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runSync detects symbols and chunks', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    await runSync(cwd, { skipEmbeddings: true, quiet: true });
    const store = readProjectStore(cwd);
    assert.ok(store);
    assert.ok(store.symbols.length > 0);
    assert.ok(store.chunks.length > 0);
    const funcs = store.symbols.filter((s) => s.kind === 'function' || s.kind === 'const');
    assert.ok(funcs.length > 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runSync detects test files', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    await runSync(cwd, { skipEmbeddings: true, quiet: true });
    const store = readProjectStore(cwd);
    assert.ok(store);
    const tests = store.files.filter((f) => f.isTest);
    assert.ok(tests.length >= 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runSync builds dependency graph', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    await runSync(cwd, { skipEmbeddings: true, quiet: true });
    const store = readProjectStore(cwd);
    assert.ok(store);
    assert.ok(store.deps.nodes.length > 0, 'expected at least 1 module');
    const a = store.deps.nodes.find((n) => n.file === 'src/a.ts');
    assert.ok(a);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runSync with skipEmbeddings does not write vectors file', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    await runSync(cwd, { skipEmbeddings: true, quiet: true });
    assert.equal(existsSync(projectVectorsPath(cwd)), false);
    const store = readProjectStore(cwd);
    assert.ok(store);
    assert.equal(store.embeddings.count, 0);
    assert.equal(store.embeddings.vectorsPath, '');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runSync without skipEmbeddings writes vectors file', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    const result = await runSync(cwd, { quiet: true });
    assert.equal(result.embeddingsSkipped, false);
    assert.ok(existsSync(projectVectorsPath(cwd)));
    const store = readProjectStore(cwd);
    assert.ok(store);
    assert.ok(store.embeddings.count > 0);
    assert.ok(store.embeddings.dim > 0);
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runSync migrates legacy files when present and rebuilds from disk', async () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, '.ai-runtime'), { recursive: true });
    writeFileSync(join(cwd, '.ai-runtime', 'repo-index.json'), JSON.stringify({
      version: 1,
      generatedAt: '2026-06-01T00:00:00.000Z',
      root: cwd,
      files: [{ path: 'legacy.ts', ext: '.ts', loc: 5, bytes: 50, isTest: false }],
      symbols: [],
      imports: [],
      chunks: [],
      tests: [],
      stats: { files: 1, symbols: 0, imports: 0, chunks: 0, testLinks: 0 },
    }));
    const result = await runSync(cwd, { skipEmbeddings: true, quiet: true });
    assert.equal(result.migrated, true);
    const store = readProjectStore(cwd);
    assert.ok(store);
    assert.equal(store.schemaVersion, 1);
    assert.equal(store.repoHash.length, 40);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runSync reports duration in result', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    const result = await runSync(cwd, { skipEmbeddings: true, quiet: true });
    assert.ok(result.durationMs >= 0);
    assert.ok(result.store.stats.durationMs >= 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runSync sets setup state localIndexReady', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    mkdirSync(join(cwd, '.ai-runtime'), { recursive: true });
    writeFileSync(join(cwd, '.ai-runtime', 'setup-state.json'), JSON.stringify({
      version: 1,
      projectName: 'fixture',
      createdAt: new Date().toISOString(),
      progress: { localIndexReady: false, dependencyMapReady: false, providersConfigured: [], chatReady: false },
    }));
    await runSync(cwd, { skipEmbeddings: true, quiet: true });
    const stateRaw = readFileSync(join(cwd, '.ai-runtime', 'setup-state.json'), 'utf8');
    const state = JSON.parse(stateRaw);
    assert.equal(state.progress.localIndexReady, true);
    assert.equal(state.progress.dependencyMapReady, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runSync stats are consistent with arrays', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    await runSync(cwd, { skipEmbeddings: true, quiet: true });
    const store = readProjectStore(cwd);
    assert.ok(store);
    assert.equal(store.stats.files, store.files.length);
    assert.equal(store.stats.symbols, store.symbols.length);
    assert.equal(store.stats.imports, store.imports.length);
    assert.equal(store.stats.chunks, store.chunks.length);
    assert.equal(store.stats.modules, store.deps.nodes.length);
    assert.equal(store.stats.cycles, store.deps.cycles.length);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runSync on empty dir produces empty store', async () => {
  const cwd = makeTmp();
  try {
    writeFile(join(cwd, 'package.json'), '{}');
    const result = await runSync(cwd, { skipEmbeddings: true, quiet: true });
    assert.ok(result);
    const store = readProjectStore(cwd);
    assert.ok(store);
    assert.equal(store.files.length, 0);
    assert.equal(store.symbols.length, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runSync progress callback is called for each phase', async () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    const phases = new Set<string>();
    await runSync(cwd, { skipEmbeddings: true, quiet: true }, (p) => phases.add(p.phase));
    assert.ok(phases.has('migrate') || phases.has('files'));
    assert.ok(phases.has('deps'));
    assert.ok(phases.has('write'));
    assert.ok(phases.has('done'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
