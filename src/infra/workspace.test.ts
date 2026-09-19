import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, resolve } from 'path';
import {
  detectRepos,
  initWorkspace,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  addRepoToWorkspace,
  removeRepoFromWorkspace,
  resolveRepoPath,
  deriveName,
  workspacePath,
  type WorkspaceConfig,
} from './workspace.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-ws-'));
}

function writeFile(p: string, content: string): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function makeMultiRepoFixture(root: string): void {
  writeFile(join(root, 'package.json'), JSON.stringify({ name: 'root' }));
  writeFile(join(root, 'apps', 'web', 'package.json'), JSON.stringify({ name: 'web' }));
  writeFile(join(root, 'apps', 'api', 'package.json'), JSON.stringify({ name: 'api' }));
  writeFile(join(root, 'packages', 'shared', 'package.json'), JSON.stringify({ name: 'shared' }));
  writeFile(join(root, 'services', 'ml', 'pyproject.toml'), '[project]\nname = "ml"');
  writeFile(join(root, 'tools', 'not-a-repo', 'README.md'), '# just a doc');
}

test('detectRepos finds TypeScript repos via package.json', () => {
  const cwd = makeTmp();
  try {
    makeMultiRepoFixture(cwd);
    const repos = detectRepos(cwd);
    const names = repos.map((r) => r.name);
    assert.ok(names.includes('web'));
    assert.ok(names.includes('api'));
    assert.ok(names.includes('shared'));
    assert.ok(names.includes('ml'));
    assert.equal(names.includes('not-a-repo'), false, 'should skip directories without project files');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('detectRepos returns empty for empty dir', () => {
  const cwd = makeTmp();
  try {
    assert.deepEqual(detectRepos(cwd), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('detectRepos ignores node_modules and other ignored dirs', () => {
  const cwd = makeTmp();
  try {
    writeFile(join(cwd, 'node_modules', 'foo', 'package.json'), '{}');
    writeFile(join(cwd, '.git', 'config'), '');
    assert.equal(detectRepos(cwd).length, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('initWorkspace creates workspace.json with detected repos', () => {
  const cwd = makeTmp();
  try {
    makeMultiRepoFixture(cwd);
    const config = initWorkspace(cwd);
    assert.ok(config.repos.length > 0);
    assert.match(config.name, /^aion-ws/);
    assert.ok(existsSync(workspacePath(cwd)));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('initWorkspace with custom name', () => {
  const cwd = makeTmp();
  try {
    const config = initWorkspace(cwd, 'my-monorepo');
    assert.equal(config.name, 'my-monorepo');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('initWorkspace with autoDetect=false creates empty workspace', () => {
  const cwd = makeTmp();
  try {
    makeMultiRepoFixture(cwd);
    const config = initWorkspace(cwd, 'empty', false);
    assert.equal(config.repos.length, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readWorkspaceConfig returns null when file missing', () => {
  const cwd = makeTmp();
  try {
    assert.equal(readWorkspaceConfig(cwd), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readWorkspaceConfig returns null on corrupted JSON', () => {
  const cwd = makeTmp();
  try {
    writeFileSync(workspacePath(cwd), '{ broken');
    assert.equal(readWorkspaceConfig(cwd), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readWorkspaceConfig returns null on missing fields', () => {
  const cwd = makeTmp();
  try {
    writeFileSync(workspacePath(cwd), JSON.stringify({}));
    assert.equal(readWorkspaceConfig(cwd), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeWorkspaceConfig + readWorkspaceConfig roundtrip', () => {
  const cwd = makeTmp();
  try {
    const config: WorkspaceConfig = {
      name: 'test',
      root: cwd,
      repos: [{ name: 'a', path: 'apps/a' }, { name: 'b', path: 'apps/b' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    writeWorkspaceConfig(cwd, config);
    const loaded = readWorkspaceConfig(cwd);
    assert.deepEqual(loaded, config);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('addRepoToWorkspace adds new repo', () => {
  const cwd = makeTmp();
  try {
    initWorkspace(cwd, 'ws', false);
    const updated = addRepoToWorkspace(cwd, { name: 'new-repo', path: 'external/new-repo' });
    assert.ok(updated);
    assert.equal(updated?.repos.length, 1);
    assert.equal(updated?.repos[0]?.name, 'new-repo');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('addRepoToWorkspace is idempotent on duplicate path', () => {
  const cwd = makeTmp();
  try {
    initWorkspace(cwd, 'ws', false);
    addRepoToWorkspace(cwd, { name: 'a', path: 'apps/a' });
    addRepoToWorkspace(cwd, { name: 'a-different-name', path: 'apps/a' });
    const config = readWorkspaceConfig(cwd);
    assert.equal(config?.repos.length, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('addRepoToWorkspace returns null when no workspace', () => {
  const cwd = makeTmp();
  try {
    assert.equal(addRepoToWorkspace(cwd, { name: 'x', path: 'x' }), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('removeRepoFromWorkspace removes by name', () => {
  const cwd = makeTmp();
  try {
    initWorkspace(cwd, 'ws', false);
    addRepoToWorkspace(cwd, { name: 'a', path: 'apps/a' });
    addRepoToWorkspace(cwd, { name: 'b', path: 'apps/b' });
    const after = removeRepoFromWorkspace(cwd, 'a');
    assert.equal(after?.repos.length, 1);
    assert.equal(after?.repos[0]?.name, 'b');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('removeRepoFromWorkspace returns null when no workspace', () => {
  const cwd = makeTmp();
  try {
    assert.equal(removeRepoFromWorkspace(cwd, 'x'), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('resolveRepoPath joins workspace root with relative repo path', () => {
  const root = resolve('/', 'home', 'user', 'workspace');
  const resolved = resolveRepoPath(root, { name: 'a', path: 'apps/a' });
  assert.equal(resolved, resolve(root, 'apps', 'a'));
});

test('deriveName takes last path segment', () => {
  assert.equal(deriveName('/a/b/c'), 'c');
  assert.equal(deriveName('/'), 'workspace');
  assert.equal(deriveName(''), 'workspace');
});
