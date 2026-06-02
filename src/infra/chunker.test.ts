import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { chunkFile, getChunkAroundLine } from './chunker.js';

test('chunkFile falls back to bounded line chunks for non Tree-sitter extensions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chunker-'));
  const file = join(dir, 'sample.py');
  try {
    writeFileSync(file, Array.from({ length: 80 }, (_, i) => `line_${i} = ${i}`).join('\n'));

    const chunks = await chunkFile(file, 100);

    assert.ok(chunks.length > 1);
    assert.equal(chunks[0]?.startLine, 1);
    assert.ok((chunks[0]?.tokens ?? 0) <= 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getChunkAroundLine returns focused context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chunk-around-'));
  const file = join(dir, 'sample.ts');
  try {
    writeFileSync(file, Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'));

    const text = await getChunkAroundLine(file, 10, 2);

    assert.equal(text, ['line 8', 'line 9', 'line 10', 'line 11', 'line 12'].join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
