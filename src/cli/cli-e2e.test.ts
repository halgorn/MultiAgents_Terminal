import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const CLI = resolve('src/index.ts');

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aion-cli-e2e-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'rag.ts'), [
    'export function retrieveContext(query: string) {',
    '  return `semantic retrieval for ${query}`;',
    '}',
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'app.ts'), [
    "import { retrieveContext } from './rag.js';",
    'export function answerQuestion(question: string) {',
    '  return retrieveContext(question);',
    '}',
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'app.test.ts'), [
    "import { answerQuestion } from './app.js';",
    'answerQuestion("hello");',
  ].join('\n'));
  return dir;
}

function runCli(repo: string, args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', CLI, '--cwd', repo, ...args], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      AION_SKIP_UPDATE_CHECK: '1',
      VOYAGE_API_KEY: '',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      OPENROUTER_API_KEY: '',
      QDRANT_URL: '',
    },
    timeout: 30_000,
  });
}

test('CLI exposes non-TTY menu fallback without hanging', () => {
  const repo = makeRepo();
  try {
    const result = runCli(repo, ['menu']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Run from an interactive terminal/);
    assert.match(result.stdout, /aion scan secrets/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI local search and memory index work on a fixture repo', () => {
  const repo = makeRepo();
  try {
    const search = runCli(repo, ['search', 'semantic retrieval context', '--semantic', '--rebuild', '--limit', '3']);
    assert.equal(search.status, 0, search.stderr);
    assert.match(search.stdout, /src\/rag\.ts/);

    const index = runCli(repo, ['memory', 'index']);
    assert.equal(index.status, 0, index.stderr);

    const query = runCli(repo, ['memory', 'query', 'answerQuestion']);
    assert.equal(query.status, 0, query.stderr);
    assert.match(query.stdout, /src\/app\.ts/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI impact-local accepts a prompted menu target equivalent without AI', () => {
  const repo = makeRepo();
  try {
    const result = runCli(repo, ['impact-local', 'src/rag.ts', '--rebuild', '--json']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /src\/rag\.ts/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
