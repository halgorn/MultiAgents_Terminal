import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAuditCache, saveAuditCache, filterChangedFiles, getCachedFindingsForFiles } from './audit-cache.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'audit-cache-'));
}

function writeFile(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

const FINDING = { file: 'src/app.ts', severity: 'high', finding: 'X', recommendation: 'Y', category: 'security' };

test('loadAuditCache returns null when no file exists', () => {
  const dir = makeTmpDir();
  try {
    assert.equal(loadAuditCache(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadAuditCache returns null for unsupported version', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, '.ai-runtime'), { recursive: true });
    writeFileSync(join(dir, '.ai-runtime', 'audit-cache.json'), JSON.stringify({ version: 1, files: {}, lastAuditAt: '', lastFindings: {} }));
    assert.equal(loadAuditCache(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveAuditCache persists and loadAuditCache reads it back (version 3)', () => {
  const dir = makeTmpDir();
  try {
    writeFile(dir, 'src/app.ts', 'const x = 1;');
    saveAuditCache(dir, ['src/app.ts'], [FINDING]);
    const cache = loadAuditCache(dir);
    assert.ok(cache !== null, 'cache should be loaded');
    assert.equal(cache!.version, 3);
    assert.ok('src/app.ts' in cache!.files);
    assert.equal(cache!.lastFindings['src/app.ts']?.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filterChangedFiles marks all files changed when no cache', () => {
  const dir = makeTmpDir();
  try {
    const { changed, unchanged } = filterChangedFiles(dir, ['src/a.ts', 'src/b.ts'], null);
    assert.deepEqual(changed, ['src/a.ts', 'src/b.ts']);
    assert.deepEqual(unchanged, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filterChangedFiles marks unmodified file as unchanged after save', () => {
  const dir = makeTmpDir();
  try {
    writeFile(dir, 'src/app.ts', 'const x = 1;');
    saveAuditCache(dir, ['src/app.ts'], [FINDING]);
    const cache = loadAuditCache(dir);
    const { changed, unchanged } = filterChangedFiles(dir, ['src/app.ts'], cache);
    assert.deepEqual(changed, []);
    assert.deepEqual(unchanged, ['src/app.ts']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filterChangedFiles marks file as changed after content modification', () => {
  const dir = makeTmpDir();
  try {
    writeFile(dir, 'src/app.ts', 'const x = 1;');
    saveAuditCache(dir, ['src/app.ts'], [FINDING]);
    // Modify file content — hash changes
    writeFileSync(join(dir, 'src/app.ts'), 'const x = 2;', 'utf8');
    const cache = loadAuditCache(dir);
    const { changed, unchanged } = filterChangedFiles(dir, ['src/app.ts'], cache);
    assert.deepEqual(changed, ['src/app.ts']);
    assert.deepEqual(unchanged, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filterChangedFiles marks new file (not in cache) as changed', () => {
  const dir = makeTmpDir();
  try {
    writeFile(dir, 'src/app.ts', 'const x = 1;');
    saveAuditCache(dir, ['src/app.ts'], []);
    writeFile(dir, 'src/new.ts', 'const y = 2;');
    const cache = loadAuditCache(dir);
    const { changed, unchanged } = filterChangedFiles(dir, ['src/app.ts', 'src/new.ts'], cache);
    assert.ok(unchanged.includes('src/app.ts'));
    assert.ok(changed.includes('src/new.ts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getCachedFindingsForFiles returns findings for unchanged files', () => {
  const dir = makeTmpDir();
  try {
    writeFile(dir, 'src/app.ts', 'const x = 1;');
    saveAuditCache(dir, ['src/app.ts'], [FINDING]);
    const cache = loadAuditCache(dir);
    const results = getCachedFindingsForFiles(cache, ['src/app.ts']);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.file, 'src/app.ts');
    assert.equal(results[0]!.severity, 'high');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getCachedFindingsForFiles returns empty for null cache', () => {
  assert.deepEqual(getCachedFindingsForFiles(null, ['src/app.ts']), []);
});
