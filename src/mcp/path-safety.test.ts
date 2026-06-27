import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { safeResolvePath, assertWithinBase, isSecretPath, PathSafetyError } from './path-safety.js';

test('safeResolvePath: rejects path traversal via ../', () => {
  const base = mkdtempSync(join(tmpdir(), 'aion-path-'));
  try {
    assert.throws(() => safeResolvePath(base, '../../../etc/passwd'), PathSafetyError);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('safeResolvePath: rejects absolute path outside base', () => {
  const base = mkdtempSync(join(tmpdir(), 'aion-path-'));
  try {
    assert.throws(() => safeResolvePath(base, '/etc/passwd'), PathSafetyError);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('safeResolvePath: rejects NUL byte injection', () => {
  const base = mkdtempSync(join(tmpdir(), 'aion-path-'));
  try {
    assert.throws(() => safeResolvePath(base, 'foo\0../../etc/passwd'), PathSafetyError);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('safeResolvePath: rejects path that exceeds length', () => {
  const base = mkdtempSync(join(tmpdir(), 'aion-path-'));
  try {
    const long = '/' + 'a'.repeat(5000);
    assert.throws(() => safeResolvePath(base, long), PathSafetyError);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('safeResolvePath: accepts relative path within base', () => {
  const base = mkdtempSync(join(tmpdir(), 'aion-path-'));
  try {
    const resolved = safeResolvePath(base, 'src/index.ts');
    assert.ok(resolved.startsWith(base));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('safeResolvePath: accepts nested relative path within base', () => {
  const base = mkdtempSync(join(tmpdir(), 'aion-path-'));
  try {
    const resolved = safeResolvePath(base, 'a/b/c/file.ts');
    assert.ok(resolved.startsWith(base));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('safeResolvePath: accepts empty when allowEmpty', () => {
  const base = mkdtempSync(join(tmpdir(), 'aion-path-'));
  try {
    const resolved = safeResolvePath(base, undefined, { allowEmpty: true });
    assert.equal(resolved, base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('safeResolvePath: rejects empty by default', () => {
  const base = mkdtempSync(join(tmpdir(), 'aion-path-'));
  try {
    assert.throws(() => safeResolvePath(base, ''), PathSafetyError);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('assertWithinBase: passes for paths inside base', () => {
  const base = mkdtempSync(join(tmpdir(), 'aion-path-'));
  try {
    assert.doesNotThrow(() => assertWithinBase(join(base, 'src/foo.ts'), base));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('assertWithinBase: rejects paths outside base', () => {
  const base = mkdtempSync(join(tmpdir(), 'aion-path-'));
  try {
    assert.throws(() => assertWithinBase('/etc/passwd', base), PathSafetyError);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('isSecretPath: detects .env files', () => {
  assert.ok(isSecretPath('/some/path/.env'));
  assert.ok(isSecretPath('.env'));
  assert.ok(isSecretPath('project/.env.local'));
  assert.ok(isSecretPath('config/.env.production'));
});

test('isSecretPath: detects ssh keys', () => {
  assert.ok(isSecretPath('/home/user/.ssh/id_rsa'));
  assert.ok(isSecretPath('id_ed25519'));
});

test('isSecretPath: detects credential files', () => {
  assert.ok(isSecretPath('.npmrc'));
  assert.ok(isSecretPath('.netrc'));
  assert.ok(isSecretPath('creds/credentials.json'));
});

test('isSecretPath: detects PEM/key files', () => {
  assert.ok(isSecretPath('certs/server.pem'));
  assert.ok(isSecretPath('keys/private.key'));
  assert.ok(isSecretPath('certs/client.p12'));
  assert.ok(isSecretPath('tls/server.crt'));
});

test('isSecretPath: does NOT flag normal source files', () => {
  assert.equal(isSecretPath('src/index.ts'), false);
  assert.equal(isSecretPath('README.md'), false);
  assert.equal(isSecretPath('package.json'), false);
  assert.equal(isSecretPath('.gitignore'), false);
});

test('safeResolvePath: integration — write file inside base', () => {
  const base = mkdtempSync(join(tmpdir(), 'aion-path-'));
  try {
    const resolved = safeResolvePath(base, 'subdir/file.txt');
    writeFileSync(resolved, 'ok');
    assert.ok(existsSync(resolved));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});