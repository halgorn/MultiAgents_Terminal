import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildRepoContext } from './repo-context.js';
import type { RepoIndex } from '../infra/repo-index.js';

test('buildRepoContext returns empty string without index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repo-context-empty-'));
  try {
    assert.equal(buildRepoContext(dir, 'auth'), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildRepoContext renders deterministic index evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repo-context-'));
  try {
    mkdirSync(join(dir, '.ai-runtime'), { recursive: true });
    const index: RepoIndex = {
      version: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      root: dir,
      files: [{ path: 'src/auth.ts', ext: '.ts', loc: 10, bytes: 100, isTest: false }],
      symbols: [{ name: 'login', kind: 'function', file: 'src/auth.ts', line: 1 }],
      imports: [],
      chunks: [],
      tests: [],
      stats: { files: 1, symbols: 1, imports: 0, chunks: 0, testLinks: 0 },
    };
    writeFileSync(join(dir, '.ai-runtime', 'repo-index.json'), JSON.stringify(index), 'utf8');

    const context = buildRepoContext(dir, 'login');

    assert.match(context, /Repository index: 1 files/);
    assert.match(context, /login function src\/auth.ts:1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
