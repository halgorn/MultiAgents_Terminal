import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createWorktree, applyDiffToRepo } from './worktree.js';

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

function makeRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'aion-wt-'));
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.email', 'test@test.com']);
  git(cwd, ['config', 'user.name', 'test']);
  // System-level core.autocrlf=true (common on Windows) would make git apply
  // rewrite LF diff output to CRLF; pin this repo to LF so assertions are stable.
  git(cwd, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(cwd, 'app.ts'), 'export const x = 1;\n');
  writeFileSync(join(cwd, '.env'), 'SECRET=abc123\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', 'init']);
  return cwd;
}

test('createWorktree strips deny-listed files from the new worktree', () => {
  const cwd = makeRepo();
  try {
    const wt = createWorktree(cwd, 'developer', 'task-1234');
    assert.ok(existsSync(join(wt, 'app.ts')));
    assert.equal(existsSync(join(wt, '.env')), false);
    assert.ok(existsSync(join(cwd, '.env')), 'original repo .env must be untouched');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyDiffToRepo applies a valid diff to the real working tree', () => {
  const cwd = makeRepo();
  try {
    const diff = [
      'diff --git a/app.ts b/app.ts',
      'index 0000000..1111111 100644',
      '--- a/app.ts',
      '+++ b/app.ts',
      '@@ -1 +1 @@',
      '-export const x = 1;',
      '+export const x = 2;',
      '',
    ].join('\n');
    const result = applyDiffToRepo(cwd, diff);
    assert.equal(result.ok, true);
    assert.equal(readFileSync(join(cwd, 'app.ts'), 'utf8'), 'export const x = 2;\n');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyDiffToRepo reports failure for a diff that does not apply', () => {
  const cwd = makeRepo();
  try {
    const badDiff = [
      'diff --git a/missing.ts b/missing.ts',
      'index 0000000..1111111 100644',
      '--- a/missing.ts',
      '+++ b/missing.ts',
      '@@ -1 +1 @@',
      '-nonexistent line',
      '+replacement',
      '',
    ].join('\n');
    const result = applyDiffToRepo(cwd, badDiff);
    assert.equal(result.ok, false);
    assert.ok(result.error && result.error.length > 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
