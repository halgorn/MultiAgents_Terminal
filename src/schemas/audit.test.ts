import test from 'node:test';
import assert from 'node:assert/strict';
import { ScanReportSchema, SEVERITY_ORDER, SEVERITY_RANK, FIX_SEVERITIES } from './audit.js';

test('SEVERITY_ORDER contains all 5 levels in descending order', () => {
  assert.deepEqual([...SEVERITY_ORDER], ['critical', 'high', 'medium', 'low', 'info']);
});

test('SEVERITY_RANK ranks critical higher than high higher than medium', () => {
  assert.ok((SEVERITY_RANK['critical'] ?? 0) > (SEVERITY_RANK['high'] ?? 0));
  assert.ok((SEVERITY_RANK['high'] ?? 0) > (SEVERITY_RANK['medium'] ?? 0));
  assert.ok((SEVERITY_RANK['medium'] ?? 0) > (SEVERITY_RANK['low'] ?? 0));
  assert.ok((SEVERITY_RANK['low'] ?? 0) > (SEVERITY_RANK['info'] ?? 0));
});

test('FIX_SEVERITIES excludes low and info', () => {
  assert.ok(!FIX_SEVERITIES.includes('low' as never));
  assert.ok(!FIX_SEVERITIES.includes('info' as never));
  assert.ok(FIX_SEVERITIES.includes('critical'));
  assert.ok(FIX_SEVERITIES.includes('high'));
  assert.ok(FIX_SEVERITIES.includes('medium'));
});

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

test('ScanReportSchema defaults missing recommendations from LLM output', () => {
  const parsed = ScanReportSchema.parse({
    filesScanned: [],
    summary: 'One finding.',
    findings: [{
      file: 'src/app.ts',
      line: 1,
      severity: 'low',
      category: 'testing',
      finding: 'Missing direct test.',
    }],
  });

  assert.equal(parsed.findings[0]?.recommendation, 'Review the finding and add a focused remediation.');
});
