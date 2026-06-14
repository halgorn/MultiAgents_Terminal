import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRefreshUpdateCache, isNewer } from './update-check.js';

test('update cache refreshes when installed version changed since last check', () => {
  const now = Date.now();
  const cache = {
    checkedAt: now,
    latestVersion: '0.2.11',
    currentVersion: '0.2.11',
  };

  assert.equal(shouldRefreshUpdateCache(cache, '0.2.17', now), true);
});

test('update cache refreshes when cached latest is older than current version', () => {
  const now = Date.now();
  const cache = {
    checkedAt: now,
    latestVersion: '0.2.11',
    currentVersion: '0.2.17',
  };

  assert.equal(shouldRefreshUpdateCache(cache, '0.2.17', now), true);
});

test('update cache is reused when current and latest are fresh', () => {
  const now = Date.now();
  const cache = {
    checkedAt: now,
    latestVersion: '0.2.19',
    currentVersion: '0.2.19',
  };

  assert.equal(shouldRefreshUpdateCache(cache, '0.2.19', now), false);
});

// ── isNewer ──────────────────────────────────────────────────────────────────

test('isNewer: 0.4.1 > 0.4.0', () => {
  assert.equal(isNewer('0.4.1', '0.4.0'), true);
});

test('isNewer: 1.0.0 > 0.9.9', () => {
  assert.equal(isNewer('1.0.0', '0.9.9'), true);
});

test('isNewer: 0.4.0 is NOT newer than 0.4.1', () => {
  assert.equal(isNewer('0.4.0', '0.4.1'), false);
});

test('isNewer: equal versions are not newer', () => {
  assert.equal(isNewer('0.4.1', '0.4.1'), false);
});

test('isNewer: minor bump detected correctly', () => {
  assert.equal(isNewer('0.5.0', '0.4.9'), true);
});

test('isNewer: patch zero vs patch non-zero', () => {
  assert.equal(isNewer('0.4.0', '0.3.99'), true);
});
