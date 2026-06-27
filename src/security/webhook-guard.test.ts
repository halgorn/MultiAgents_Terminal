import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWebhookUrl, sanitizeWebhookPayload, isPrivateIp, WebhookValidationError } from './webhook-guard.js';

test('validateWebhookUrl: accepts public HTTPS', () => {
  const url = validateWebhookUrl('https://hooks.example.com/notify');
  assert.equal(url.hostname, 'hooks.example.com');
  assert.equal(url.protocol, 'https:');
});

test('validateWebhookUrl: rejects http:// to public host', () => {
  assert.throws(
    () => validateWebhookUrl('http://hooks.example.com/notify'),
    WebhookValidationError,
  );
});

test('validateWebhookUrl: rejects localhost by default', () => {
  assert.throws(() => validateWebhookUrl('https://localhost/hook'), WebhookValidationError);
  assert.throws(() => validateWebhookUrl('http://127.0.0.1/hook'), WebhookValidationError);
});

test('validateWebhookUrl: rejects RFC1918 IPv4 ranges', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254']) {
    assert.throws(
      () => validateWebhookUrl(`https://${ip}/hook`),
      WebhookValidationError,
      `should reject ${ip}`,
    );
  }
});

test('validateWebhookUrl: rejects IPv6 loopback and private', () => {
  assert.throws(() => validateWebhookUrl('https://[::1]/hook'), WebhookValidationError);
  assert.throws(() => validateWebhookUrl('https://[fe80::1]/hook'), WebhookValidationError);
  assert.throws(() => validateWebhookUrl('https://[fc00::1]/hook'), WebhookValidationError);
});

test('validateWebhookUrl: rejects non-http protocols', () => {
  assert.throws(() => validateWebhookUrl('file:///etc/passwd'), WebhookValidationError);
  assert.throws(() => validateWebhookUrl('gopher://example.com/'), WebhookValidationError);
  assert.throws(() => validateWebhookUrl('javascript:alert(1)'), WebhookValidationError);
});

test('validateWebhookUrl: rejects URL with credentials', () => {
  assert.throws(() => validateWebhookUrl('https://user:pass@example.com/'), WebhookValidationError);
});

test('validateWebhookUrl: rejects empty/invalid', () => {
  assert.throws(() => validateWebhookUrl(''), WebhookValidationError);
  assert.throws(() => validateWebhookUrl('not-a-url'), WebhookValidationError);
  assert.throws(() => validateWebhookUrl('https://'), WebhookValidationError);
});

test('validateWebhookUrl: rejects oversized URL', () => {
  const long = 'https://example.com/' + 'a'.repeat(3000);
  assert.throws(() => validateWebhookUrl(long), WebhookValidationError);
});

test('validateWebhookUrl: allowPrivate permits internal targets', () => {
  const url = validateWebhookUrl('https://hooks.internal.local/hook', { allowPrivate: true });
  assert.equal(url.hostname, 'hooks.internal.local');
});

test('validateWebhookUrl: allowedHosts enforces allowlist', () => {
  validateWebhookUrl('https://allowed.example.com/hook', { allowedHosts: ['allowed.example.com'] });
  assert.throws(
    () => validateWebhookUrl('https://other.example.com/hook', { allowedHosts: ['allowed.example.com'] }),
    WebhookValidationError,
  );
});

test('isPrivateIp: detects private ranges', () => {
  assert.ok(isPrivateIp('10.0.0.1'));
  assert.ok(isPrivateIp('192.168.1.1'));
  assert.ok(isPrivateIp('172.20.0.1'));
  assert.ok(isPrivateIp('127.0.0.1'));
  assert.ok(isPrivateIp('::1'));
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('1.1.1.1'), false);
});

test('sanitizeWebhookPayload: strips reportHtml and oversized fields', () => {
  const payload = {
    summary: 'ok',
    reportHtml: '<html>...</html>',
    count: 42,
    rawContent: 'x'.repeat(200_000),
  };
  const clean = sanitizeWebhookPayload(payload);
  assert.equal(clean['summary'], 'ok');
  assert.equal(clean['count'], 42);
  assert.match(String(clean['reportHtml']), /stripped/);
  assert.match(String(clean['rawContent']), /stripped/);
});

test('sanitizeWebhookPayload: keeps small payloads intact', () => {
  const payload = { summary: 'audit done', count: 5 };
  const clean = sanitizeWebhookPayload(payload);
  assert.deepEqual(clean, payload);
});