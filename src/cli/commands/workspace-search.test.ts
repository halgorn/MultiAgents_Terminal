import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runWorkspaceSearch,
  renderWorkspaceSearchMarkdown,
  renderWorkspaceWikiMarkdown,
  collectWorkspaceStores,
  writeWorkspaceWiki,
} from './workspace-search.js';
import { initWorkspace, readWorkspaceConfig, resolveRepoPath } from '../../infra/workspace.js';
import { writeProjectStore, type ProjectStore } from '../../infra/project-store.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-wssearch-'));
}

function writeFile(p: string, content: string): void {
  const dir = p.substring(0, p.lastIndexOf('/'));
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(p, content);
}

function makeFixture(cwd: string): void {
  writeFile(join(cwd, 'apps', 'web', 'package.json'), JSON.stringify({ name: 'web' }));
  writeFile(join(cwd, 'apps', 'web', 'tsconfig.json'), '{}');
  writeFile(join(cwd, 'apps', 'web', 'src', 'a.ts'), 'export function hello(): string {\n  return "hi";\n}\n');
  writeFile(join(cwd, 'apps', 'api', 'package.json'), JSON.stringify({ name: 'api' }));
  writeFile(join(cwd, 'apps', 'api', 'tsconfig.json'), '{}');
  writeFile(join(cwd, 'apps', 'api', 'src', 'auth.ts'), 'export function login(): string {\n  return "token";\n}\n');
}

function makeStore(cwd: string, files: number): ProjectStore {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: cwd,
    repoHash: 'abc',
    files: [],
    symbols: [],
    imports: [],
    chunks: [
      { file: 'src/auth.ts', name: 'login', type: 'function', startLine: 1, endLine: 5, tokens: 20 },
    ],
    tests: [],
    embeddings: { model: 'Xenova/test', dim: 384, vectorsPath: 'project.vectors.bin', count: 1 },
    deps: {
      nodes: [{ file: 'src/auth.ts', imports: [], importedBy: [], exports: ['login'], loc: 5 }],
      cycles: [],
      hotspots: [],
    },
    stats: { files, symbols: 1, imports: 0, chunks: 1, testLinks: 0, vectors: 1, modules: 1, cycles: 0, durationMs: 10 },
  };
}

test('runWorkspaceSearch throws when no workspace', async () => {
  const cwd = makeTmp();
  try {
    await assert.rejects(() => runWorkspaceSearch({ workspaceRoot: cwd, query: 'auth' }), /No workspace.json/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkspaceSearch returns empty when no repos have PIL', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    initWorkspace(cwd, 'ws');
    const result = await runWorkspaceSearch({ workspaceRoot: cwd, query: 'auth' });
    assert.equal(result.reposSearched, 0);
    assert.equal(result.results.length, 0);
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkspaceSearch searches across all repos with PIL', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    initWorkspace(cwd, 'ws');
    const config = readWorkspaceConfig(cwd)!;
    const { writeVectors, projectVectorsPath } = await import('../../infra/project-store.js');
    for (const repo of config.repos) {
      const repoPath = resolveRepoPath(cwd, repo);
      writeProjectStore(repoPath, makeStore(repoPath, 3));
      const floats = new Float32Array(384);
      for (let i = 0; i < 384; i++) floats[i] = Math.random();
      writeVectors(repoPath, floats, 384);
      void projectVectorsPath;
    }
    const result = await runWorkspaceSearch({ workspaceRoot: cwd, query: 'auth' });
    assert.ok(result.reposSearched >= 1, `expected ≥1, got ${result.reposSearched}`);
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('renderWorkspaceSearchMarkdown groups by repo', () => {
  const md = renderWorkspaceSearchMarkdown({
    results: [
      { repo: { name: 'web', path: 'apps/web' }, file: 'src/a.ts', name: 'hello', type: 'function', startLine: 1, endLine: 5, score: 0.9 },
      { repo: { name: 'api', path: 'apps/api' }, file: 'src/b.ts', name: 'login', type: 'function', startLine: 1, endLine: 5, score: 0.8 },
    ],
    query: 'auth',
    reposSearched: 2,
  });
  assert.match(md, /# Workspace search: "auth"/);
  assert.match(md, /## apps\/web/);
  assert.match(md, /## apps\/api/);
  assert.match(md, /90\.0%/);
});

test('renderWorkspaceWikiMarkdown aggregates stats', () => {
  const cwd = '/tmp/ws';
  const config = {
    name: 'test-ws',
    root: cwd,
    repos: [
      { name: 'web', path: 'apps/web' },
      { name: 'api', path: 'apps/api' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const stores = new Map<string, ProjectStore>();
  stores.set('apps/web', makeStore('/tmp/ws/apps/web', 5));
  stores.set('apps/api', makeStore('/tmp/ws/apps/api', 3));
  const md = renderWorkspaceWikiMarkdown(config, stores);
  assert.match(md, /# Workspace: test-ws/);
  assert.match(md, /Files: 8/);
  assert.match(md, /### apps\/web/);
  assert.match(md, /### apps\/api/);
  assert.match(md, /## How to use this workspace/);
});

test('renderWorkspaceWikiMarkdown handles missing PILs', () => {
  const cwd = '/tmp/ws';
  const config = {
    name: 'empty',
    root: cwd,
    repos: [{ name: 'web', path: 'apps/web' }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const md = renderWorkspaceWikiMarkdown(config, new Map());
  assert.match(md, /No PIL found/);
});

test('renderWorkspaceWikiMarkdown shows cycles warning', () => {
  const cwd = '/tmp/ws';
  const config = {
    name: 'ws',
    root: cwd,
    repos: [{ name: 'a', path: 'a' }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const store = makeStore('/tmp/ws/a', 5);
  store.deps.cycles = [['a.ts', 'b.ts', 'a.ts']];
  const stores = new Map([['a', store]]);
  const md = renderWorkspaceWikiMarkdown(config, stores);
  assert.match(md, /circular dependency/);
});

test('collectWorkspaceStores returns map of repos with PIL', () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    initWorkspace(cwd, 'ws');
    const config = readWorkspaceConfig(cwd)!;
    for (const repo of config.repos) {
      const repoPath = resolveRepoPath(cwd, repo);
      writeProjectStore(repoPath, makeStore(repoPath, 1));
    }
    const stores = collectWorkspaceStores(config);
    assert.equal(stores.size, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeWorkspaceWiki creates file in .ai-runtime/', () => {
  const cwd = makeTmp();
  try {
    const path = writeWorkspaceWiki(cwd, '# test');
    assert.ok(existsSync(path));
    assert.match(path, /\.ai-runtime[\\\/]WORKSPACE\.md$/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
