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

test('ScanReportSchema normalizes non-positive finding line to null', () => {
  const parsed = ScanReportSchema.parse({
    filesScanned: [],
    summary: 'One finding.',
    findings: [{
      file: 'src/app.ts',
      line: 0,
      severity: 'low',
      category: 'testing',
      finding: 'Missing direct test.',
      recommendation: 'Add a focused test.',
    }],
  });

  assert.equal(parsed.findings[0]?.line, null);
});
