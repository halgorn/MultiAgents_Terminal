import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { embedBatch, embedText, embedTextRemote, EmbeddingStore } from './embeddings.js';
import { JsonFileStore, QdrantStore } from './vector-store.js';
import { rerankLocal, rerankWithLLM, setRerankerClientFactoryForTest } from './reranker.js';
import { withEnv } from '../test-utils/fixtures.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'aion-rag-'));
}


test('local embeddings are deterministic and remote embedding failures surface clearly', async () => {
  const first = Array.from(embedText('semantic retrieval context', 2_000));
  const second = Array.from(embedText('semantic retrieval context', 2_000));
  assert.deepEqual(second, first);
  assert.equal(await withEnv({ VOYAGE_API_KEY: undefined, OPENAI_API_KEY: undefined }, () => embedTextRemote('query')).then((v) => v?.length), 384);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('down', { status: 503 });
  try {
    await withEnv({ VOYAGE_API_KEY: 'voyage-test', OPENAI_API_KEY: undefined }, async () => {
      await assert.rejects(() => embedBatch(['query']), /Voyage API 503/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('EmbeddingStore skips corrupted cache and tolerates mismatched dimensions', async () => {
  const root = makeDir();
  try {
    mkdirSync(join(root, 'notes'), { recursive: true });
    writeFileSync(join(root, 'notes', 'one.md'), 'semantic retrieval context');
    const store = new EmbeddingStore(root);
    await withEnv({ VOYAGE_API_KEY: undefined, OPENAI_API_KEY: undefined }, async () => {
      assert.equal(await store.buildIndex(['notes']), 1);
    });

    writeFileSync(join(root, '.embeddings', 'notes', 'broken.md.json'), '{not json');
    writeFileSync(join(root, '.embeddings', 'notes', 'short.md.json'), JSON.stringify({
      vector: [1, 2],
      mtime: 1,
      text: 'wrong dimensions',
      provider: 'hash-384d (local, no API key)',
    }));

    const results = await withEnv({ VOYAGE_API_KEY: undefined, OPENAI_API_KEY: undefined }, () => store.query('semantic retrieval', 5));

    assert.equal(results.some((result) => result.filename === 'one.md'), true);
    assert.equal(results.some((result) => result.filename === 'broken.md'), false);
    assert.equal(results.some((result) => result.filename === 'short.md'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('JsonFileStore handles duplicate upsert, empty search, clear, and corrupted files', async () => {
  const root = makeDir();
  try {
    const file = join(root, 'vectors.json');
    const store = new JsonFileStore(file);
    assert.deepEqual(await store.search(Array.from(embedText('query', 500)), 3), []);

    await store.upsert('src/app.ts', Array.from(embedText('old', 500)), { file: 'src/app.ts' });
    await store.upsert('src/app.ts', Array.from(embedText('new query', 500)), { file: 'src/app.ts', version: 2 });
    assert.equal(store.size(), 1);
    assert.equal((await store.search(Array.from(embedText('new query', 500)), 1))[0]?.payload['version'], 2);

    await store.clear();
    assert.equal(store.size(), 0);

    writeFileSync(file, 'not json');
    assert.equal(new JsonFileStore(file).size(), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('QdrantStore can be mocked for create, upsert, search, clear, and API failures', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/collections/aion-test') && !init?.method) return new Response('missing', { status: 404 });
    if (url.endsWith('/points/search')) return Response.json({ result: [{ score: 0.9, payload: { _id: 'src/app.ts', file: 'src/app.ts' } }] });
    return new Response('{}', { status: 200 });
  };
  try {
    const store = new QdrantStore('http://qdrant.test', 'aion-test');
    await store.upsert('src/app.ts', [1, 0], { file: 'src/app.ts' });
    const results = await store.search([1, 0], 1);
    await store.clear();

    assert.equal(results[0]?.id, 'src/app.ts');
    assert.equal(calls.some((call) => call.startsWith('PUT') && call.includes('/collections/aion-test')), true);
    assert.equal(calls.some((call) => call.startsWith('DELETE')), true);

    globalThis.fetch = async () => new Response('bad', { status: 500 });
    await assert.rejects(() => new QdrantStore('http://qdrant.test', 'bad').upsert('x', [1], {}), /Qdrant create collection: 500/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reranker falls back on missing key, bad JSON, and provider errors', async () => {
  const candidates = [
    { id: 'a', content: 'billing invoice' },
    { id: 'b', content: 'semantic retrieval context' },
  ];

  const local = rerankLocal('semantic retrieval', candidates, 2);
  assert.equal(local[0]?.id, 'b');

  await withEnv({ ANTHROPIC_API_KEY: undefined }, async () => {
    assert.deepEqual(await rerankWithLLM('semantic retrieval', candidates, 2), [{ id: 'a', rank: 0 }, { id: 'b', rank: 1 }]);
  });

  setRerankerClientFactoryForTest(() => ({
    messages: {
      create: async () => ({ content: [{ type: 'text', text: 'not json' }] }),
    },
  }) as never);
  try {
    await withEnv({ ANTHROPIC_API_KEY: 'test' }, async () => {
      assert.deepEqual(await rerankWithLLM('semantic retrieval', candidates, 2), [{ id: 'a', rank: 0 }, { id: 'b', rank: 1 }]);
    });
  } finally {
    setRerankerClientFactoryForTest(null);
  }
});
