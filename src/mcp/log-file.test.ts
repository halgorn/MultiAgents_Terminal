import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RotatingLog, defaultLogPath, createRotatingLog } from './log-file.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-log-'));
}

test('RotatingLog writes JSON line per record', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'test.log') });
    log.write({ ts: '2026-06-18T12:00:00Z', level: 'info', msg: 'hello' });
    const content = readFileSync(join(cwd, 'test.log'), 'utf8');
    assert.match(content, /^{"ts":"2026-06-18T12:00:00Z"/);
    assert.match(content, /\n$/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('RotatingLog creates parent directory', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'nested', 'deep', 'test.log') });
    log.write({ msg: 'hi' });
    assert.ok(existsSync(join(cwd, 'nested', 'deep', 'test.log')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('RotatingLog batch write', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'batch.log') });
    log.writeBatch([
      { i: 0 },
      { i: 1 },
      { i: 2 },
    ]);
    const lines = readFileSync(join(cwd, 'batch.log'), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 3);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('RotatingLog batch with empty array is no-op', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'empty.log') });
    log.writeBatch([]);
    assert.equal(existsSync(join(cwd, 'empty.log')), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('RotatingLog rotates when exceeding maxBytes', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'rot.log'), maxBytes: 100, maxBackups: 2 });
    for (let i = 0; i < 50; i++) {
      log.write({ ts: '2026-06-18T12:00:00Z', level: 'info', msg: 'x'.repeat(10) });
    }
    assert.ok(existsSync(join(cwd, 'rot.log')));
    const hasBackup = existsSync(join(cwd, 'rot.log.1'));
    assert.ok(hasBackup, 'expected backup file after rotation');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('RotatingLog keeps only maxBackups backups', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'rot.log'), maxBytes: 50, maxBackups: 2 });
    for (let i = 0; i < 200; i++) {
      log.write({ ts: '2026-06-18T12:00:00Z', level: 'info', msg: 'x'.repeat(20) });
    }
    const backup3 = existsSync(join(cwd, 'rot.log.3'));
    assert.equal(backup3, false, 'expected maxBackups=2');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readSince filters by timestamp', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'since.log') });
    log.write({ ts: '2026-06-18T11:00:00Z', msg: 'old' });
    log.write({ ts: '2026-06-18T12:00:00Z', msg: 'new' });
    log.write({ ts: '2026-06-18T13:00:00Z', msg: 'newer' });
    const lines = log.readSince('2026-06-18T12:00:00Z');
    assert.equal(lines.length, 2);
    assert.equal(lines.includes('old'), false, 'old should be filtered out');
    assert.equal(lines.some((l) => l.includes('new')), true);
    assert.equal(lines.some((l) => l.includes('newer')), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readLastN returns N most recent lines', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'lastn.log') });
    for (let i = 0; i < 10; i++) log.write({ i });
    const last3 = log.readLastN(3);
    assert.equal(last3.length, 3);
    assert.match(last3[2] ?? '', /"i":9/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('readSince on missing file returns empty', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'missing.log') });
    assert.deepEqual(log.readSince(), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('size returns 0 for missing file', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'missing.log') });
    assert.equal(log.size(), 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('size returns bytes after writes', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'sized.log') });
    log.write({ a: 1 });
    log.write({ b: 2 });
    assert.ok(log.size() > 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('clear empties the file', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'clear.log') });
    log.write({ a: 1 });
    log.clear();
    assert.equal(log.size(), 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('defaultLogPath returns .ai-runtime/mcp.log', () => {
  const p = defaultLogPath('/x');
  assert.match(p, /\.ai-runtime[\\\/]mcp\.log$/);
});

test('createRotatingLog uses default path', () => {
  const cwd = makeTmp();
  try {
    const log = createRotatingLog(cwd);
    log.write({ msg: 'hi' });
    assert.ok(existsSync(join(cwd, '.ai-runtime', 'mcp.log')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('createRotatingLog with custom path', () => {
  const cwd = makeTmp();
  try {
    const log = createRotatingLog(cwd, join(cwd, 'custom.log'));
    log.write({ msg: 'hi' });
    assert.ok(existsSync(join(cwd, 'custom.log')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('rotateIfNeeded is no-op when file does not exist', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'never.log') });
    log.rotateIfNeeded();
    assert.equal(existsSync(join(cwd, 'never.log')), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('rotateIfNeeded is no-op when under maxBytes', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'under.log'), maxBytes: 10000 });
    log.write({ msg: 'small' });
    log.rotateIfNeeded();
    assert.equal(existsSync(join(cwd, 'under.log.1')), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('malformed lines are filtered by readSince', () => {
  const cwd = makeTmp();
  try {
    const log = new RotatingLog({ path: join(cwd, 'mixed.log') });
    log.write({ ts: '2026-06-18T12:00:00Z', msg: 'ok' });
    appendFileSync(join(cwd, 'mixed.log'), 'not-json\n', 'utf8');
    const lines = log.readSince('2026-06-18T11:00:00Z');
    assert.equal(lines.length, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
