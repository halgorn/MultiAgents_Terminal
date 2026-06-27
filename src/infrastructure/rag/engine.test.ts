import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PilEngine, bm25DocsFromChunks } from './engine.js';
import { query } from './query.js';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'aion-eng-'));
}

function makeChunks(): Array<{ id: string; file: string; startLine: number; endLine: number; text: string; language?: string }> {
  return [
    { id: 'src/auth/login.ts:1', file: 'src/auth/login.ts', startLine: 1, endLine: 50, text: 'authentication login user authentication password credentials session verifyCredentials function authenticate user login form session', language: 'ts' },
    { id: 'src/auth/middleware.ts:1', file: 'src/auth/middleware.ts', startLine: 1, endLine: 40, text: 'authentication middleware session cookie checks redirects login password verifyCredentials authenticate', language: 'ts' },
    { id: 'src/utils/hash.ts:1', file: 'src/utils/hash.ts', startLine: 1, endLine: 30, text: 'sha256 hash utility password storage cryptography digest', language: 'ts' },
    { id: 'src/api/users.ts:1', file: 'src/api/users.ts', startLine: 1, endLine: 60, text: 'user endpoint api route handler lookup list users authenticate login session', language: 'ts' },
    { id: 'README.md:1', file: 'README.md', startLine: 1, endLine: 100, text: 'project documentation overview guide', language: 'md' },
  ];
}

test('PilEngine: hybrid query fuses BM25 + vector', async () => {
  const dir = freshDir();
  try {
    const chunks = makeChunks();
    const engine = new PilEngine(dir, { chunks });
    await engine.waitReady();
    const result = await query(engine, { text: 'authentication login password', topK: 3 }, 'trace');
    assert.ok(result.hits.length > 0, 'should return at least one hit');
    const topIds = result.hits.map((h) => h.id);
    assert.ok(topIds.some((id) => id.includes('auth')), `expected auth hit, got ${JSON.stringify(topIds)}`);
    assert.equal(result.meta.rerankerUsed, 'none');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PilEngine: BM25-only mode finds lexical matches', async () => {
  const dir = freshDir();
  try {
    const chunks = makeChunks();
    const engine = new PilEngine(dir, { chunks });
    await engine.waitReady();
    const result = await query(engine, { text: 'sha256', topK: 3, mode: 'bm25' }, 'trace');
    assert.equal(result.hits[0]!.id, 'src/utils/hash.ts:1');
    assert.equal(result.meta.mode, 'bm25');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PilEngine: vector-only mode finds semantic-ish matches', async () => {
  const dir = freshDir();
  try {
    const chunks = makeChunks();
    const engine = new PilEngine(dir, { chunks });
    await engine.waitReady();
    const result = await query(engine, { text: 'user lookup endpoint', topK: 3, mode: 'vector' }, 'trace');
    assert.equal(result.meta.mode, 'vector');
    assert.ok(result.hits.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PilEngine: filters apply by filePrefix', async () => {
  const dir = freshDir();
  try {
    const chunks = makeChunks();
    const engine = new PilEngine(dir, { chunks });
    await engine.waitReady();
    const result = await query(engine, {
      text: 'authentication login', topK: 10, mode: 'bm25',
      filters: { filePrefix: 'src/auth/' },
    }, 'trace');
    assert.ok(result.hits.length > 0, 'should have hits before filter');
    assert.ok(result.hits.every((h) => h.id.startsWith('src/auth/')));
    assert.ok(result.meta.filtersApplied !== undefined, 'filtersApplied should be set');
    assert.ok(result.meta.filtersApplied! >= 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PilEngine: filters apply by fileSuffix', async () => {
  const dir = freshDir();
  try {
    const chunks = makeChunks();
    const engine = new PilEngine(dir, { chunks });
    await engine.waitReady();
    const result = await query(engine, {
      text: 'auth', topK: 10, mode: 'bm25',
      filters: { fileSuffix: '.ts' },
    }, 'trace');
    assert.ok(result.hits.every((h) => h.id.endsWith('.ts:1') || h.id.includes('.ts:')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PilEngine: fileMetadata lookup works', async () => {
  const dir = freshDir();
  try {
    const chunks = makeChunks();
    const engine = new PilEngine(dir, { chunks });
    await engine.waitReady();
    const meta = engine.fileMetadata('src/auth/login.ts:1');
    assert.ok(meta);
    assert.equal(meta?.file, 'src/auth/login.ts');
    assert.equal(meta?.language, 'ts');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PilEngine: persist + reload preserves state', async () => {
  const dir = freshDir();
  try {
    const chunks = makeChunks();
    const engine1 = new PilEngine(dir, { chunks });
    await engine1.persist();

    const engine2 = await PilEngine.load(dir);
    const result = await query(engine2, { text: 'authentication', topK: 3, mode: 'bm25' }, 'trace');
    assert.ok(result.hits.length > 0);
    assert.equal(result.hits[0]!.id, 'src/auth/login.ts:1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PilEngine: cache hits on repeated queries', async () => {
  const dir = freshDir();
  try {
    const chunks = makeChunks();
    const engine = new PilEngine(dir, { chunks });
    await engine.waitReady();
    await query(engine, { text: 'login', topK: 3, mode: 'vector' }, 't1');
    await query(engine, { text: 'login', topK: 3, mode: 'vector' }, 't2');
    const stats = engine.cacheStats();
    assert.ok(stats.hits >= 1, 'second identical query should hit cache');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PilEngine: LLM reranker integration works', async () => {
  const dir = freshDir();
  try {
    const chunks = makeChunks();
    const engine = new PilEngine(dir, { chunks });
    await engine.waitReady();
    const reranker = async (_query: string, candidates: { id: string; score: number }[]) => {
      return candidates.slice().reverse().map((c) => c.id);
    };
    const result = await query(engine, {
      text: 'authentication', topK: 2, mode: 'hybrid', reranker: 'llm', rerankerTopK: 5,
    }, 'trace', { reranker });
    assert.equal(result.meta.rerankerUsed, 'llm');
    assert.ok(result.hits.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bm25DocsFromChunks: returns BM25Doc array', () => {
  const docs = bm25DocsFromChunks(makeChunks());
  assert.equal(docs.length, 5);
  assert.equal(docs[0]!.id, 'src/auth/login.ts:1');
});