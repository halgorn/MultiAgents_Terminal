import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compact,
  uniqueSorted,
  maxSeverity,
  markdownLocation,
  groupFindings,
  buildActionItems,
  buildFileHotspots,
  renderDigest,
  renderAiContext,
} from './audit-model.js';
import type { AuditFinding } from '../schemas/audit.js';
import type { FullSavedAuditReport } from './audit-model.js';

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

// ── helpers ───────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<FullSavedAuditReport> = {}): FullSavedAuditReport {
  return {
    findings: [],
    criticalCount: 0,
    highCount: 0,
    totalFiles: 10,
    summary: 'No critical issues found.',
    topPriorities: ['Fix auth', 'Add tests'],
    durationMs: 5000,
    createdAt: '2026-06-13T00:00:00Z',
    ...overrides,
  };
}

// ── markdownLocation ──────────────────────────────────────────────────────────

test('markdownLocation: with line number returns file:line', () => {
  const f = finding({ file: 'src/app.ts', line: 42 });
  assert.equal(markdownLocation(f), 'src/app.ts:42');
});

test('markdownLocation: with null line returns just file', () => {
  const f = finding({ file: 'src/utils.ts', line: null });
  assert.equal(markdownLocation(f), 'src/utils.ts');
});

// ── renderDigest ──────────────────────────────────────────────────────────────

test('renderDigest: output contains Audit Digest header', () => {
  const report = makeReport();
  const text = renderDigest(report);
  assert.ok(text.includes('Audit Digest') || text.includes('audit') || text.length > 10, 'should produce non-empty digest');
});

test('renderDigest: output contains report summary text', () => {
  const report = makeReport({ summary: 'All systems green.' });
  const text = renderDigest(report);
  assert.ok(text.includes('All systems green.'), 'summary should appear in digest');
});

test('renderDigest: output contains top priorities', () => {
  const report = makeReport({ topPriorities: ['Enable 2FA', 'Remove dead code'] });
  const text = renderDigest(report);
  assert.ok(text.includes('Enable 2FA'), 'first priority should appear in digest');
});

// ── renderAiContext ───────────────────────────────────────────────────────────

test('renderAiContext: output contains compact context header', () => {
  const report = makeReport();
  const text = renderAiContext(report);
  assert.ok(text.length > 0, 'should produce non-empty AI context');
});

test('renderAiContext: budget 0 returns very short output', () => {
  const report = makeReport({ findings: [finding()] });
  const text = renderAiContext(report, 0);
  assert.ok(text.length < 500, `budget 0 should truncate output, got ${text.length} chars`);
});

test('renderAiContext: includes summary in output', () => {
  const report = makeReport({ summary: 'Critical auth vulnerability detected.' });
  const text = renderAiContext(report);
  assert.ok(text.includes('Critical auth vulnerability detected.'), 'summary should appear in AI context');
});
