import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeDbConfig } from './db-config-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'db-config-analyzer-'));
}

test('analyzeDbConfig: no config files → Visibility issue (low)', () => {
  const dir = makeDir();
  try {
    const result = analyzeDbConfig(dir);
    const vis = result.issues.find((i) => i.area === 'Visibility');
    assert.ok(vis, 'should report Visibility issue when no config files exist');
    assert.equal(vis?.severity, 'low');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbConfig: sslmode=disable in .env → TLS issue (high)', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, '.env'), 'DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=disable\n');
    const result = analyzeDbConfig(dir);
    const tlsIssue = result.issues.find((i) => i.area === 'TLS');
    assert.ok(tlsIssue, 'should detect disabled SSL');
    assert.equal(tlsIssue?.severity, 'high');
    assert.ok(result.sslDisabledSignals > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbConfig: plaintext password in connection string → Secrets issue (high)', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, '.env'), 'DATABASE_URL=postgres://admin:hunter2@db.internal:5432/prod\n');
    const result = analyzeDbConfig(dir);
    const secretsIssue = result.issues.find((i) => i.area === 'Secrets');
    assert.ok(secretsIssue, 'should detect plaintext password in connection string');
    assert.ok(result.plaintextPasswordSignals > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbConfig: pool and timeout config present → no Pooling/Timeouts issues', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'knexfile.js'), "module.exports = { connection: { connectionLimit: 10, connect_timeout: 5000 } };\n");
    const result = analyzeDbConfig(dir);
    assert.equal(result.issues.find((i) => i.area === 'Pooling'), undefined);
    assert.equal(result.issues.find((i) => i.area === 'Timeouts'), undefined);
    assert.ok(result.poolConfigSignals > 0);
    assert.ok(result.timeoutConfigSignals > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbConfig: score never drops below 0', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, '.env'), 'DATABASE_URL=postgres://admin:hunter2@db.internal:5432/prod?sslmode=disable\n');
    const result = analyzeDbConfig(dir);
    assert.ok(result.score >= 0, `score should be >= 0, got ${result.score}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
