import test from 'node:test';
import assert from 'node:assert/strict';
import { ZOD_SCHEMA_REGISTRY, KNOWN_OUTPUT_SCHEMAS } from './registry.js';

const EXPECTED_SCHEMAS = [
  'ScanReportSchema',
  'AuditReportSchema',
  'PatchReportSchema',
  'ReviewReportSchema',
  'EvidenceReportSchema',
  'QAResultSchema',
  'PlanReportSchema',
];

test('ZOD_SCHEMA_REGISTRY: contains all 7 expected schema keys', () => {
  for (const name of EXPECTED_SCHEMAS) {
    assert.ok(name in ZOD_SCHEMA_REGISTRY, `missing schema: ${name}`);
  }
});

test('ZOD_SCHEMA_REGISTRY: all values are Zod schemas with parse method', () => {
  for (const [name, schema] of Object.entries(ZOD_SCHEMA_REGISTRY)) {
    assert.ok(typeof schema.parse === 'function', `${name}: should have parse()`);
    assert.ok(typeof schema.safeParse === 'function', `${name}: should have safeParse()`);
  }
});

test('KNOWN_OUTPUT_SCHEMAS: contains all registry keys', () => {
  for (const name of Object.keys(ZOD_SCHEMA_REGISTRY)) {
    assert.ok(KNOWN_OUTPUT_SCHEMAS.has(name), `missing ${name} in KNOWN_OUTPUT_SCHEMAS`);
  }
});

test('KNOWN_OUTPUT_SCHEMAS: contains special non-registry schemas', () => {
  assert.ok(KNOWN_OUTPUT_SCHEMAS.has('string'), 'should include "string" for agents returning raw text');
  assert.ok(KNOWN_OUTPUT_SCHEMAS.has('AuditReport'), 'should include AuditReport');
  assert.ok(KNOWN_OUTPUT_SCHEMAS.has('SynthOutputSchema'), 'should include SynthOutputSchema');
});

test('ZOD_SCHEMA_REGISTRY: ScanReportSchema validates minimal report', () => {
  const schema = ZOD_SCHEMA_REGISTRY['ScanReportSchema']!;
  const result = schema.safeParse({ filesScanned: [], findings: [], summary: 'ok' });
  assert.ok(result.success, 'minimal ScanReport should parse successfully');
});
