import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldExcludePath, isExcluded, DEFAULT_EXCLUDE_PATTERNS } from './exclude-list.js';

test('shouldExcludePath: detects .env files', () => {
  assert.ok(isExcluded('project/.env'));
  assert.ok(isExcluded('.env'));
  assert.ok(isExcluded('a/b/.env.local'));
  assert.ok(isExcluded('a/b/.env.production'));
});

test('shouldExcludePath: detects ssh keys', () => {
  assert.ok(isExcluded('.ssh/id_rsa'));
  assert.ok(isExcluded('/home/user/.ssh/id_ed25519'));
  assert.ok(isExcluded('.ssh/known_hosts'));
});

test('shouldExcludePath: detects credential basenames', () => {
  assert.ok(isExcluded('.npmrc'));
  assert.ok(isExcluded('.netrc'));
  assert.ok(isExcluded('credentials.json'));
  assert.ok(isExcluded('service-account.json'));
});

test('shouldExcludePath: detects PEM/key/cert extensions', () => {
  assert.ok(isExcluded('certs/server.pem'));
  assert.ok(isExcluded('keys/private.key'));
  assert.ok(isExcluded('tls/client.p12'));
  assert.ok(isExcluded('certs/server.crt'));
  assert.ok(isExcluded('keystore.jks'));
});

test('shouldExcludePath: detects secret directories', () => {
  assert.ok(isExcluded('.aws/credentials'));
  assert.ok(isExcluded('.kube/config'));
  assert.ok(isExcluded('.docker/config.json'));
  assert.ok(isExcluded('secrets/api-key.txt'));
});

test('shouldExcludePath: does NOT flag normal source files', () => {
  assert.equal(isExcluded('src/index.ts'), false);
  assert.equal(isExcluded('README.md'), false);
  assert.equal(isExcluded('package.json'), false);
  assert.equal(isExcluded('.gitignore'), false);
  assert.equal(isExcluded('docs/architecture.md'), false);
});

test('shouldExcludePath: handles Windows-style paths', () => {
  assert.ok(isExcluded('project\\.env'));
  assert.ok(isExcluded('a\\b\\secrets\\key.txt'));
});

test('shouldExcludePath: explicit glob patterns', () => {
  assert.ok(isExcluded('config/prod.yaml', ['**/prod.*']));
  assert.ok(isExcluded('secrets/api.txt', ['secrets/**']));
  assert.equal(isExcluded('config/dev.yaml', ['**/prod.*']), false);
});

test('shouldExcludePath: returns structured result', () => {
  const r1 = shouldExcludePath('.env');
  assert.equal(r1.excluded, true);
  assert.equal(r1.reason, 'secret_basename');
  const r2 = shouldExcludePath('.ssh/id_rsa');
  assert.equal(r2.excluded, true);
  assert.equal(r2.reason, 'secret_dir');
  const r3 = shouldExcludePath('cert.pem');
  assert.equal(r3.excluded, true);
  assert.equal(r3.reason, 'secret_extension');
});

test('DEFAULT_EXCLUDE_PATTERNS is non-empty and well-formed', () => {
  assert.ok(DEFAULT_EXCLUDE_PATTERNS.length > 0);
  for (const p of DEFAULT_EXCLUDE_PATTERNS) {
    assert.ok(p.length > 0);
    assert.ok(p.startsWith('**'));
  }
});