import test from 'node:test';
import assert from 'node:assert/strict';
import { AuditFindingSchema, ScanReportSchema, SEVERITY_ORDER, SEVERITY_RANK, FIX_SEVERITIES } from './audit.js';
import { ToolRegistry } from '../infra/tool-registry.js';

const BASE_FINDING = {
  file: 'src/auth.ts',
  line: 5,
  severity: 'high' as const,
  category: 'security',
  finding: 'Hardcoded secret',
  recommendation: 'Use env vars',
};

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

// ── AuditFindingSchema: category normalization ────────────────────────────────

test('AuditFindingSchema: unknown category normalized to maintainability', () => {
  const result = AuditFindingSchema.parse({ ...BASE_FINDING, category: 'not-a-real-category' });
  assert.equal(result.category, 'maintainability');
});

test('AuditFindingSchema: known categories preserved without normalization', () => {
  const known = ['security', 'architecture', 'performance', 'testing', 'bugs', 'observability'];
  for (const cat of known) {
    const result = AuditFindingSchema.parse({ ...BASE_FINDING, category: cat });
    assert.equal(result.category, cat, `expected ${cat} to pass through unchanged`);
  }
});

test('AuditFindingSchema: persona field is optional', () => {
  const withPersona = AuditFindingSchema.parse({ ...BASE_FINDING, persona: 'security' });
  assert.equal(withPersona.persona, 'security');
  const without = AuditFindingSchema.parse(BASE_FINDING);
  assert.equal(without.persona, undefined);
});

// ── ToolRegistry: structural invariants ──────────────────────────────────────

test('ToolRegistry: required[] fields are all defined in properties', () => {
  for (const tool of ToolRegistry) {
    const required = (tool.inputSchema.required as string[] | undefined) ?? [];
    const props = Object.keys((tool.inputSchema.properties as Record<string, unknown>) ?? {});
    for (const field of required) {
      assert.ok(
        props.includes(field),
        `${tool.name}: required field "${field}" not in properties`,
      );
    }
  }
});

test('ToolRegistry: each property schema has a type field', () => {
  for (const tool of ToolRegistry) {
    const properties = (tool.inputSchema.properties as Record<string, { type?: unknown }>) ?? {};
    for (const [propName, propDef] of Object.entries(properties)) {
      assert.ok(
        typeof propDef.type === 'string',
        `${tool.name}.${propName}: property is missing a "type" field`,
      );
    }
  }
});
