import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compact,
  uniqueSorted,
  maxSeverity,
  groupFindings,
  buildActionItems,
  buildFileHotspots,
} from './audit-model.js';
import type { AuditFinding } from '../schemas/audit.js';

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    file: 'src/app.ts',
    line: null,
    severity: 'high',
    category: 'security',
    finding: 'Hardcoded credential',
    recommendation: 'Use env var',
    ...overrides,
  };
}

// ── compact ───────────────────────────────────────────────────────────────────

test('compact: short string returns unchanged', () => {
  assert.equal(compact('hello'), 'hello');
});

test('compact: long string truncated with ellipsis', () => {
  const result = compact('a'.repeat(130));
  assert.equal(result.length, 120);
  assert.ok(result.endsWith('...'));
});

test('compact: collapses internal whitespace', () => {
  assert.equal(compact('foo   bar'), 'foo bar');
});

// ── uniqueSorted ──────────────────────────────────────────────────────────────

test('uniqueSorted: deduplicates and sorts alphabetically', () => {
  assert.deepEqual(uniqueSorted(['b', 'a', 'b', 'c']), ['a', 'b', 'c']);
});

test('uniqueSorted: filters empty strings', () => {
  assert.deepEqual(uniqueSorted(['x', '', 'y']), ['x', 'y']);
});

// ── maxSeverity ───────────────────────────────────────────────────────────────

test('maxSeverity: returns critical over high and medium', () => {
  const findings = [
    finding({ severity: 'medium' }),
    finding({ severity: 'critical' }),
    finding({ severity: 'high' }),
  ];
  assert.equal(maxSeverity(findings), 'critical');
});

test('maxSeverity: returns info for empty array', () => {
  assert.equal(maxSeverity([]), 'info');
});

// ── groupFindings ─────────────────────────────────────────────────────────────

test('groupFindings: groups by key function result', () => {
  const findings = [
    finding({ file: 'a.ts', severity: 'high' }),
    finding({ file: 'b.ts', severity: 'medium' }),
    finding({ file: 'a.ts', severity: 'low' }),
  ];
  const groups = groupFindings(findings, (f) => f.file);
  assert.equal(Object.keys(groups).length, 2);
  assert.equal(groups['a.ts']?.length, 2);
  assert.equal(groups['b.ts']?.length, 1);
});

// ── buildActionItems ──────────────────────────────────────────────────────────

test('buildActionItems: assigns sequential IDs starting from 1', () => {
  const findings = [
    finding({ severity: 'high', finding: 'Issue A' }),
    finding({ severity: 'medium', finding: 'Issue B' }),
  ];
  const items = buildActionItems(findings);
  assert.ok(items.length >= 1);
  assert.equal(items[0]!.id, 1);
});

test('buildActionItems: sorts critical findings before medium', () => {
  const findings = [
    finding({ severity: 'medium', finding: 'Medium issue here' }),
    finding({ severity: 'critical', finding: 'Critical issue here' }),
  ];
  const items = buildActionItems(findings);
  assert.equal(items[0]!.severity, 'critical');
});

test('buildActionItems: deduplicates semantically similar findings', () => {
  // Two findings with same text but different file paths — should merge
  const findings = [
    finding({ file: 'src/a.ts', line: 10, finding: 'SQL injection via query parameter' }),
    finding({ file: 'src/b.ts', line: 20, finding: 'SQL injection via query parameter' }),
  ];
  const items = buildActionItems(findings);
  // Both have same normalized key — should be one action item with two file refs
  assert.equal(items.length, 1);
  assert.equal(items[0]!.files.length, 2);
});

test('buildActionItems: distinct findings remain separate action items', () => {
  const findings = [
    finding({ finding: 'Hardcoded password in config' }),
    finding({ finding: 'Missing input validation on user form' }),
  ];
  const items = buildActionItems(findings);
  assert.equal(items.length, 2);
});

test('buildActionItems: empty input returns empty array', () => {
  assert.deepEqual(buildActionItems([]), []);
});

// ── buildFileHotspots ─────────────────────────────────────────────────────────

test('buildFileHotspots: groups by file with finding count', () => {
  const findings = [
    finding({ file: 'src/auth.ts', severity: 'critical' }),
    finding({ file: 'src/auth.ts', severity: 'high' }),
    finding({ file: 'src/utils.ts', severity: 'low' }),
  ];
  const hotspots = buildFileHotspots(findings);
  assert.equal(hotspots.length, 2);
  const auth = hotspots.find((h) => h.file === 'src/auth.ts');
  assert.equal(auth?.findings, 2);
  assert.equal(auth?.maxSeverity, 'critical');
});

test('buildFileHotspots: sorts highest severity file first', () => {
  const findings = [
    finding({ file: 'src/low.ts', severity: 'low' }),
    finding({ file: 'src/crit.ts', severity: 'critical' }),
  ];
  const hotspots = buildFileHotspots(findings);
  assert.equal(hotspots[0]!.file, 'src/crit.ts');
});

test('buildFileHotspots: deduplicates categories per file', () => {
  const findings = [
    finding({ file: 'src/app.ts', category: 'security' }),
    finding({ file: 'src/app.ts', category: 'security' }),
    finding({ file: 'src/app.ts', category: 'maintainability' }),
  ];
  const hotspots = buildFileHotspots(findings);
  assert.equal(hotspots[0]!.categories.length, 2);
});
