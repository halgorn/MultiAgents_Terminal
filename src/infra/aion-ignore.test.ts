import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isIgnored, loadIgnorePatterns } from './aion-ignore.js';

test('loadIgnorePatterns converts simple glob patterns safely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-ignore-'));
  try {
    writeFileSync(join(dir, '.aionignore'), [
      '# comment',
      'dist/**',
      '*.generated.ts',
    ].join('\n'));

    const patterns = loadIgnorePatterns(dir);

    assert.equal(isIgnored('dist/index.js', patterns), true);
    assert.equal(isIgnored('src/foo.generated.ts', patterns), true);
    assert.equal(isIgnored('src/app.ts', patterns), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadIgnorePatterns skips oversized or wildcard-heavy patterns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-ignore-'));
  try {
    writeFileSync(join(dir, '.aionignore'), [
      'src/**',
      '*'.repeat(250),
      Array.from({ length: 50 }, () => '*').join('/'),
    ].join('\n'));

    const patterns = loadIgnorePatterns(dir);

    assert.equal(patterns.length, 1);
    assert.equal(isIgnored('src/app.ts', patterns), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
