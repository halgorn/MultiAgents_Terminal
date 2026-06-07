import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildRepoIndex } from './repo-index.js';
import { buildRepoVectorIndex, ensureRepoVectorIndex, queryRepoVectors } from './repo-vectors.js';

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'repo-vectors-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'rag.ts'), [
    'export function retrieveContext(query: string) {',
    '  return `semantic retrieval for ${query}`;',
    '}',
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'billing.ts'), [
    'export function calculateInvoice(total: number) {',
    '  return total * 1.2;',
    '}',
  ].join('\n'));
  return dir;
}

test('repo vector index supports deterministic zero-token semantic search', async () => {
  const dir = makeRepo();
  try {
    const index = await buildRepoIndex(dir);
    const vectors = buildRepoVectorIndex(dir, index);
    const results = queryRepoVectors(vectors, 'semantic retrieval context', 3);

    assert.ok(results.length > 0);
    assert.equal(results[0]?.file, 'src/rag.ts');
    assert.match(results[0]?.text ?? '', /retrieveContext/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureRepoVectorIndex reuses a valid cache for unchanged repo index', async () => {
  const dir = makeRepo();
  try {
    const index = await buildRepoIndex(dir);
    const first = ensureRepoVectorIndex(dir, index, true);
    const second = ensureRepoVectorIndex(dir, index, false);

    assert.equal(second.repoHash, first.repoHash);
    assert.equal(second.entries.length, first.entries.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
