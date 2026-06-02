import test from 'node:test';
import assert from 'node:assert/strict';
import type { RepoIndex } from './repo-index.js';
import { formatRepoQuery, queryRepoIndex } from './repo-query.js';

const index: RepoIndex = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  root: '/repo',
  files: [
    { path: 'src/app.ts', ext: '.ts', loc: 10, bytes: 100, isTest: false },
    { path: 'src/app.test.ts', ext: '.ts', loc: 5, bytes: 50, isTest: true },
    { path: 'src/util.ts', ext: '.ts', loc: 6, bytes: 60, isTest: false },
  ],
  symbols: [
    { name: 'App', kind: 'class', file: 'src/app.ts', line: 1 },
    { name: 'helper', kind: 'function', file: 'src/util.ts', line: 1 },
  ],
  imports: [{ from: 'src/app.ts', specifier: './util', resolved: 'src/util.ts' }],
  chunks: [],
  tests: [{ source: 'src/app.ts', tests: ['src/app.test.ts'] }],
  stats: { files: 3, symbols: 2, imports: 1, chunks: 0, testLinks: 1 },
};

test('queryRepoIndex returns files, symbols, imports, and tests', () => {
  const result = queryRepoIndex(index, 'App');

  assert.equal(result.files[0]?.path, 'src/app.ts');
  assert.equal(result.symbols[0]?.name, 'App');
  assert.equal(result.imports[0]?.resolved, 'src/util.ts');
  assert.equal(result.tests[0]?.tests[0], 'src/app.test.ts');
});

test('formatRepoQuery renders deterministic evidence', () => {
  const text = formatRepoQuery(queryRepoIndex(index, 'helper'));

  assert.match(text, /Symbols:/);
  assert.match(text, /helper function src\/util.ts:1/);
});
