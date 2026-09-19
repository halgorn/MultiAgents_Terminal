import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { runWorkspaceSync, listRepos, renderWorkspaceSummary } from './workspace.js';
import { initWorkspace, readWorkspaceConfig } from '../../infra/workspace.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-wscmd-'));
}

function writeFile(p: string, content: string): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function makeFixture(cwd: string): void {
  writeFile(join(cwd, 'apps', 'web', 'package.json'), JSON.stringify({ name: 'web', version: '1.0.0' }));
  writeFile(join(cwd, 'apps', 'web', 'tsconfig.json'), '{}');
  writeFile(join(cwd, 'apps', 'web', 'src', 'a.ts'), 'export function hello(): string {\n  return "hi";\n}\n');
  writeFile(join(cwd, 'apps', 'api', 'package.json'), JSON.stringify({ name: 'api', version: '1.0.0' }));
  writeFile(join(cwd, 'apps', 'api', 'tsconfig.json'), '{}');
  writeFile(join(cwd, 'apps', 'api', 'src', 'a.ts'), 'export function hello(): string {\n  return "hi";\n}\n');
}

test('listRepos returns all repos with language info', () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    const config = initWorkspace(cwd, 'ws');
    const items = listRepos(config);
    assert.equal(items.length, 2);
    for (const item of items) {
      assert.ok(['web', 'api'].includes(item.repo.name));
      assert.equal(item.language, 'typescript');
      assert.equal(item.hasPackageJson, true);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('renderWorkspaceSummary produces markdown output', () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    const config = initWorkspace(cwd, 'ws');
    const result = {
      workspace: config,
      results: config.repos.map((repo) => ({ repo, durationMs: 100 })),
      totalDurationMs: 200,
    };
    const md = renderWorkspaceSummary(result);
    assert.match(md, /# Workspace: ws/);
    assert.match(md, /## Repositories/);
    assert.match(md, /## Summary/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('renderWorkspaceSummary shows failed repos', () => {
  const cwd = makeTmp();
  try {
    makeFixture(cwd);
    const config = initWorkspace(cwd, 'ws');
    const result = {
      workspace: config,
      results: [
        { repo: config.repos[0]!, durationMs: 100 },
        { repo: config.repos[1]!, durationMs: 50, error: 'failed' },
      ],
      totalDurationMs: 150,
    };
    const md = renderWorkspaceSummary(result);
    assert.match(md, /failed: failed/);
    assert.match(md, /Synced: 1/);
    assert.match(md, /Failed: 1/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkspaceSync throws when no workspace.json', async () => {
  const cwd = makeTmp();
  try {
    await assert.rejects(() => runWorkspaceSync(cwd, {}), /No workspace.json/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkspaceSync runs sync on all repos in parallel', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    initWorkspace(cwd, 'ws');
    const result = await runWorkspaceSync(cwd, { skipEmbeddings: true });
    assert.equal(result.results.length, 2);
    for (const r of result.results) {
      assert.equal(r.error, undefined);
      assert.ok(r.durationMs >= 0);
    }
    assert.ok(result.totalDurationMs >= 0);
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWorkspaceSync captures per-repo errors without failing overall', async () => {
  const cwd = makeTmp();
  try {
    initWorkspace(cwd, 'ws', false);
    const { addRepoToWorkspace } = await import('../../infra/workspace.js');
    addRepoToWorkspace(cwd, { name: 'missing', path: 'apps/missing' });
    const config = readWorkspaceConfig(cwd)!;
    const result = await runWorkspaceSync(cwd, { skipEmbeddings: true });
    const missing = result.results.find((r) => r.repo.name === 'missing');
    assert.ok(missing);
    assert.ok(missing?.error);
    void config;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
