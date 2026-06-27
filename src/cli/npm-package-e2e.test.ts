import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, readdirSync, writeFileSync } from 'fs';
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

test('packed npm tarball installs and exposes aion binary', { timeout: 120_000 }, () => {
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
    const aionBin = join(projectDir, 'node_modules', '.bin', 'aion');
    const installedCli = join(projectDir, 'node_modules', '@aionlabsai', 'aion', 'dist', 'index.js');
    assert.equal(existsSync(aionBin), true);
    assert.equal(existsSync(installedCli), true);

    const aionHelp = run(process.execPath, [installedCli, '--help'], projectDir);
    assert.equal(aionHelp.status, 0, aionHelp.stderr);
    assert.match(aionHelp.stdout, /Usage:/);

    const aionTldr = run(process.execPath, [installedCli, '--tldr'], projectDir);
    assert.equal(aionTldr.status, 0, aionTldr.stderr);
    assert.match(aionTldr.stdout, /project gateway/);

    const aionVersion = run(process.execPath, [installedCli, '--version'], projectDir);
    assert.equal(aionVersion.status, 0, aionVersion.stderr);
    assert.match(aionVersion.stdout.trim(), /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});