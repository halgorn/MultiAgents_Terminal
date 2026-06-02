import test from 'node:test';
import assert from 'node:assert/strict';
import { ScanReportSchema } from './audit.js';

test('ScanReportSchema tolerates numeric filesScanned from LLM output', () => {
  const parsed = ScanReportSchema.parse({
    filesScanned: 1396,
    findings: [],
    summary: 'No findings.',
  });

  assert.deepEqual(parsed.filesScanned, []);
});
