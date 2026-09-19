import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildRepoIndex, writeRepoIndex } from './repo-index.js';

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'repo-index-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/util.ts'), [
    'export function helper() {',
    '  return 1;',
    '}',
  ].join('\n'));
  writeFileSync(join(dir, 'src/app.ts'), [
    "import { helper } from './util';",
    'export class App {',
    '  run() { return helper(); }',
    '}',
  ].join('\n'));
  writeFileSync(join(dir, 'src/app.test.ts'), [
    "import { App } from './app';",
    'test("runs", () => new App().run());',
  ].join('\n'));
  return dir;
}

test('buildRepoIndex captures files, symbols, imports, chunks, and test links', async () => {
  const dir = makeRepo();
  try {
    const index = await buildRepoIndex(dir);

    assert.equal(index.stats.files, 3);
    assert.ok(index.symbols.some((symbol) => symbol.name === 'App'));
    assert.ok(index.symbols.some((symbol) => symbol.name === 'helper'));
    assert.ok(index.imports.some((imp) => imp.from === 'src/app.ts' && imp.resolved === 'src/util.ts'));
    assert.ok(index.chunks.some((chunk) => chunk.file === 'src/app.ts'));
    assert.ok(index.tests.some((link) => link.source === 'src/app.ts' && link.tests.includes('src/app.test.ts')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRepoIndex persists under .ai-runtime', async () => {
  const dir = makeRepo();
  try {
    const index = await buildRepoIndex(dir);
    const path = writeRepoIndex(dir, index);

    assert.equal(path.endsWith(join('.ai-runtime', 'repo-index.json')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
