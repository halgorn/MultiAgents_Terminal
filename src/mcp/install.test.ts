import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import {
  installCursor,
  installClaude,
  installCodex,
  installOpencode,
  installClient,
  doctorCheck,
  type InstallOptions,
} from './install.js';
import { withEnv } from '../test-utils/fixtures.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-install-'));
}

// os.homedir() reads USERPROFILE on Windows and HOME on POSIX — both must be
// overridden or these tests silently fall through to the real home directory.
function withFakeHome<T>(fakeHome: string, fn: () => T): T {
  return withEnv({ HOME: fakeHome, USERPROFILE: fakeHome }, fn) as T;
}

function baseOpts(cwd: string, overrides: Partial<InstallOptions> = {}): InstallOptions {
  return {
    client: 'cursor',
    cwd,
    binPath: '/usr/local/bin/aion',
    args: ['mcp', 'serve'],
    ...overrides,
  };
}

test('installCursor creates new config', () => {
  const cwd = makeTmp();
  try {
    const r = installCursor(baseOpts(cwd));
    assert.equal(r.written, true);
    assert.ok(existsSync(join(cwd, '.cursor', 'mcp.json')));
    const cfg = JSON.parse(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8'));
    assert.deepEqual(cfg.mcpServers.aion, { command: '/usr/local/bin/aion', args: ['mcp', 'serve'] });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('installCursor preserves existing entries', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, '.cursor'), { recursive: true });
    writeFileSync(join(cwd, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'foo' } } }));
    installCursor(baseOpts(cwd));
    const cfg = JSON.parse(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8'));
    assert.ok(cfg.mcpServers.other);
    assert.ok(cfg.mcpServers.aion);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('installCursor dryRun does not write', () => {
  const cwd = makeTmp();
  try {
    installCursor(baseOpts(cwd, { dryRun: true }));
    assert.equal(existsSync(join(cwd, '.cursor', 'mcp.json')), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('installCursor uninstall removes aion entry', () => {
  const cwd = makeTmp();
  try {
    installCursor(baseOpts(cwd));
    const r = installCursor(baseOpts(cwd, { uninstall: true }));
    assert.equal(r.written, true);
    const cfg = JSON.parse(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8'));
    assert.equal(cfg.mcpServers.aion, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('installCursor uninstall is no-op when not present', () => {
  const cwd = makeTmp();
  try {
    const r = installCursor(baseOpts(cwd, { uninstall: true }));
    assert.equal(r.written, false);
    assert.match(r.message, /not present/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('installClaude creates config in home dir', () => {
  const cwd = makeTmp();
  const fakeHome = makeTmp();
  try {
    withFakeHome(fakeHome, () => {
      const r = installClaude(baseOpts(cwd));
      assert.ok(r.path.includes('.claude'));
      assert.ok(r.path.startsWith(fakeHome), 'must write under the fake home, not the real one');
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('installCodex creates TOML config', () => {
  const cwd = makeTmp();
  const fakeHome = makeTmp();
  try {
    withFakeHome(fakeHome, () => {
      const r = installCodex(baseOpts(cwd));
      assert.equal(r.written, true);
      const path = join(fakeHome, '.codex', 'config.toml');
      assert.ok(existsSync(path));
      const content = readFileSync(path, 'utf8');
      assert.match(content, /\[mcp_servers\.aion\]/);
      assert.match(content, /command = "\/usr\/local\/bin\/aion"/);
      assert.match(content, /args = \["mcp", "serve"\]/);
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('installCodex preserves other sections', () => {
  const fakeHome = makeTmp();
  try {
    withFakeHome(fakeHome, () => {
      mkdirSync(join(fakeHome, '.codex'), { recursive: true });
      writeFileSync(join(fakeHome, '.codex', 'config.toml'), '[other]\nkey = "value"\n');
      installCodex(baseOpts(makeTmp()));
      const content = readFileSync(join(fakeHome, '.codex', 'config.toml'), 'utf8');
      assert.match(content, /\[other\]/);
      assert.match(content, /\[mcp_servers\.aion\]/);
    });
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('installCodex escapes quotes in args', () => {
  const fakeHome = makeTmp();
  try {
    withFakeHome(fakeHome, () => {
      installCodex(baseOpts(makeTmp(), { args: ['with "quote"'] }));
      const content = readFileSync(join(fakeHome, '.codex', 'config.toml'), 'utf8');
      assert.match(content, /\\"/);
    });
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('installCodex uninstall removes section', () => {
  const fakeHome = makeTmp();
  try {
    withFakeHome(fakeHome, () => {
      installCodex(baseOpts(makeTmp()));
      const r = installCodex(baseOpts(makeTmp(), { uninstall: true }));
      assert.equal(r.written, true);
      const content = readFileSync(join(fakeHome, '.codex', 'config.toml'), 'utf8');
      assert.doesNotMatch(content, /\[mcp_servers\.aion\]/);
    });
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('installOpencode creates config with command array', () => {
  const cwd = makeTmp();
  try {
    installOpencode(baseOpts(cwd));
    const path = join(cwd, 'opencode.json');
    assert.ok(existsSync(path));
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(cfg.mcp.aion.type, 'local');
    assert.deepEqual(cfg.mcp.aion.command, ['/usr/local/bin/aion', 'mcp', 'serve']);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('installOpencode uninstall removes entry', () => {
  const cwd = makeTmp();
  try {
    installOpencode(baseOpts(cwd));
    installOpencode(baseOpts(cwd, { uninstall: true }));
    const cfg = JSON.parse(readFileSync(join(cwd, 'opencode.json'), 'utf8'));
    assert.equal(cfg.mcp.aion, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('installClient with "all" tries all 4', () => {
  const cwd = makeTmp();
  const fakeHome = makeTmp();
  try {
    withFakeHome(fakeHome, () => {
      const results = installClient({ client: 'all', cwd, binPath: '/a', args: ['mcp', 'serve'] });
      assert.equal(results.length, 4);
      const clients = results.map((r) => r.client);
      assert.ok(clients.includes('cursor'));
      assert.ok(clients.includes('claude'));
      assert.ok(clients.includes('codex'));
      assert.ok(clients.includes('opencode'));
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('installClient with single client returns 1', () => {
  const cwd = makeTmp();
  try {
    const results = installClient(baseOpts(cwd, { client: 'cursor' }));
    assert.equal(results.length, 1);
    assert.equal(results[0]?.client, 'cursor');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctorCheck returns missing for non-existent config', () => {
  const cwd = makeTmp();
  try {
    const checks = doctorCheck(cwd, 'cursor');
    assert.equal(checks[0]?.status, 'missing');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctorCheck returns ok after install', () => {
  const cwd = makeTmp();
  try {
    installCursor(baseOpts(cwd));
    const checks = doctorCheck(cwd, 'cursor');
    assert.equal(checks[0]?.status, 'ok');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctorCheck returns broken when file exists but no aion', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, '.cursor'), { recursive: true });
    writeFileSync(join(cwd, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {} }));
    const checks = doctorCheck(cwd, 'cursor');
    assert.equal(checks[0]?.status, 'broken');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctorCheck covers all 4 clients when no arg', () => {
  const cwd = makeTmp();
  try {
    const checks = doctorCheck(cwd);
    assert.equal(checks.length, 4);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('homedir is used for claude/codex', () => {
  const fakeHome = makeTmp();
  try {
    withFakeHome(fakeHome, () => {
      installClaude({ client: 'claude', cwd: makeTmp(), binPath: '/a', args: ['mcp', 'serve'] });
      const claudePath = join(fakeHome, '.claude', 'mcp.json');
      assert.ok(existsSync(claudePath), 'must write under the fake home, not the real one');
      const cfg = JSON.parse(readFileSync(claudePath, 'utf8'));
      assert.ok(cfg.mcpServers.aion);
    });
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
