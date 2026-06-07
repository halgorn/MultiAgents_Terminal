import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRefreshUpdateCache } from './update-check.js';

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
