import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { WORKSPACE_ROOT, isolatedEnv } from '../test-utils/fixtures.js';

function run(command: string, args: string[], cwd: string, timeout = 60_000) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: isolatedEnv(),
    timeout,
  });
}

test('packed npm tarball installs and exposes aion and ai-runtime binaries', { timeout: 120_000 }, () => {
  const packDir = mkdtempSync(join(tmpdir(), 'aion-pack-'));
  const projectDir = mkdtempSync(join(tmpdir(), 'aion-installed-'));

  try {
    const pack = run('npm', ['pack', '--pack-destination', packDir, '--silent'], WORKSPACE_ROOT);
    assert.equal(pack.status, 0, pack.stderr);

    const tgz = readdirSync(packDir).find((file) => file.endsWith('.tgz'));
    assert.ok(tgz, 'npm pack should create a tarball');
    writeFileSync(join(projectDir, 'package.json'), '{"type":"module"}\n');

    const install = run('npm', ['install', '--silent', '--no-audit', '--no-fund', join(packDir, tgz)], projectDir);
    assert.equal(install.status, 0, install.stderr);

    const aionHelp = run('npx', ['aion', '--help'], projectDir);
    assert.equal(aionHelp.status, 0, aionHelp.stderr);
    assert.match(aionHelp.stdout, /Multi-agent AI engineering runtime/);

    const runtimeVersion = run('npx', ['ai-runtime', '--version'], projectDir);
    assert.equal(runtimeVersion.status, 0, runtimeVersion.stderr);
    assert.match(runtimeVersion.stdout.trim(), /^\d+\.\d+\.\d+$/);

    const menuFallback = run('npx', ['aion', 'menu'], projectDir);
    assert.equal(menuFallback.status, 0, menuFallback.stderr);
    assert.match(menuFallback.stdout, /Run in an interactive terminal/);

    const assistHelp = run('npx', ['aion', 'assist', '--help'], projectDir);
    assert.equal(assistHelp.status, 0, assistHelp.stderr);
    assert.match(assistHelp.stdout, /Assisted setup/);

    const deployHelp = run('npx', ['aion', 'deploy', '--help'], projectDir);
    assert.equal(deployHelp.status, 0, deployHelp.stderr);
    assert.match(deployHelp.stdout, /Assisted CI\/deploy/);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
