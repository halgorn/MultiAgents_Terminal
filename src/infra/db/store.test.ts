import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

test('store rejects unsafe path segment identifiers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-store-test-'));
  process.env['AI_RUNTIME_DB_PATH'] = dir;

  try {
    const store = await import('./store.js');

    assert.throws(
      () => store.loadTask('../escape'),
      /Invalid task id/,
    );

    assert.throws(
      () => store.saveEvidenceEntry('task-1', '../agent', {}),
      /Invalid agent name/,
    );
  } finally {
    delete process.env['AI_RUNTIME_DB_PATH'];
    rmSync(dir, { recursive: true, force: true });
  }
});
