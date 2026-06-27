import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'fs';
import { makeFixtureRepo, runSourceCli } from '../test-utils/fixtures.js';

test('CLI exposes non-TTY menu fallback without hanging', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const result = runSourceCli(repo, ['menu']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Run in an interactive terminal/);
    assert.match(result.stdout, /aion scan secrets/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI help, version, cwd validation work without providers', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const help = runSourceCli(repo, ['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage:/);

    const version = runSourceCli(repo, ['--version']);
    assert.equal(version.status, 0);
    assert.match(version.stdout, /\d+\.\d+\.\d+/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI tldr flag shows short command overview', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const result = runSourceCli(repo, ['--tldr']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /project gateway/);
    assert.match(result.stdout, /aion init/);
    assert.match(result.stdout, /aion sync/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI reports expected errors for missing local indexes', () => {
  const repo = makeFixtureRepo('aion-cli-e2e-');
  try {
    const result = runSourceCli(repo, ['sync']);
    assert.equal(result.status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});