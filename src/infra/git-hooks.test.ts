import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installPostCommitHook, isHookInstalled } from './git-hooks.js';

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-hooks-'));
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  return dir;
}

function makeNonGitDir(): string {
  return mkdtempSync(join(tmpdir(), 'non-git-'));
}

// ── installPostCommitHook ─────────────────────────────────────────────────────

test('installPostCommitHook: returns false for non-git directory', () => {
  const dir = makeNonGitDir();
  try {
    assert.equal(installPostCommitHook(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installPostCommitHook: creates hook file in git repo', () => {
  const dir = makeGitRepo();
  try {
    const result = installPostCommitHook(dir);
    assert.equal(result, true);
    const hook = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
    assert.ok(hook.includes('aion index'), 'hook should call aion index');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installPostCommitHook: hook file starts with shebang', () => {
  const dir = makeGitRepo();
  try {
    installPostCommitHook(dir);
    const hook = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
    assert.ok(hook.startsWith('#!/bin/sh'), `expected shebang, got: ${hook.slice(0, 20)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installPostCommitHook: idempotent — second call does not duplicate hook', () => {
  const dir = makeGitRepo();
  try {
    installPostCommitHook(dir);
    installPostCommitHook(dir);
    const hook = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
    const count = (hook.match(/aion index/g) ?? []).length;
    assert.equal(count, 1, `aion index should appear exactly once, found ${count}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installPostCommitHook: appends to existing hook without overwriting', () => {
  const dir = makeGitRepo();
  try {
    const existingHook = '#!/bin/sh\n\necho "custom hook"\n';
    writeFileSync(join(dir, '.git', 'hooks', 'post-commit'), existingHook, 'utf8');
    installPostCommitHook(dir);
    const hook = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf8');
    assert.ok(hook.includes('custom hook'), 'existing hook content should be preserved');
    assert.ok(hook.includes('aion index'), 'aion hook should be appended');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── isHookInstalled ───────────────────────────────────────────────────────────

test('isHookInstalled: false for non-git directory', () => {
  const dir = makeNonGitDir();
  try {
    assert.equal(isHookInstalled(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isHookInstalled: false when hook file does not exist', () => {
  const dir = makeGitRepo();
  try {
    assert.equal(isHookInstalled(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isHookInstalled: false when hook file exists but lacks marker', () => {
  const dir = makeGitRepo();
  try {
    writeFileSync(join(dir, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho done\n', 'utf8');
    assert.equal(isHookInstalled(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isHookInstalled: true after installPostCommitHook', () => {
  const dir = makeGitRepo();
  try {
    installPostCommitHook(dir);
    assert.equal(isHookInstalled(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
