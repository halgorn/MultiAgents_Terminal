import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compactText,
  compactScanReport,
  fallbackAuditReport,
  recount,
  FindingAggregator,
  MAX_FINDING_TEXT,
} from './finding-aggregator.js';
import type { AuditFinding, ScanReport } from '../schemas/audit.js';

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    severity: 'high',
    category: 'security',
    file: 'src/app.ts',
    line: 10,
    finding: 'SQL injection via unescaped input',
    recommendation: 'Use parameterized queries',
    ...overrides,
  };
}

describe('compactText', () => {
  it('returns short text unchanged', () => {
    assert.equal(compactText('short'), 'short');
  });

  it('truncates long text and appends ...', () => {
    const long = 'a'.repeat(MAX_FINDING_TEXT + 50);
    const result = compactText(long);
    assert.equal(result.length, MAX_FINDING_TEXT + 3);
    assert.ok(result.endsWith('...'));
  });

  it('normalizes whitespace', () => {
    assert.equal(compactText('foo   bar\nbaz'), 'foo bar baz');
  });
});

describe('compactScanReport', () => {
  it('limits findings to maxFindings', () => {
    const findings = Array.from({ length: 20 }, (_, i) => makeFinding({ line: i }));
    const report: ScanReport = { filesScanned: [], findings, summary: 'test' };
    const compacted = compactScanReport(report, 5);
    assert.equal(compacted.findings.length, 5);
  });

  it('sorts findings by severity before truncating', () => {
    const findings = [
      makeFinding({ severity: 'low', line: 1 }),
      makeFinding({ severity: 'critical', line: 2 }),
      makeFinding({ severity: 'medium', line: 3 }),
    ];
    const report: ScanReport = { filesScanned: [], findings, summary: 'test' };
    const compacted = compactScanReport(report, 2);
    assert.equal(compacted.findings[0]!.severity, 'critical');
    assert.equal(compacted.findings[1]!.severity, 'medium');
  });

  it('limits filesScanned to 80', () => {
    const files = Array.from({ length: 100 }, (_, i) => `file${i}.ts`);
    const report: ScanReport = { filesScanned: files, findings: [], summary: '' };
    assert.equal(compactScanReport(report).filesScanned.length, 80);
  });
});

describe('fallbackAuditReport', () => {
  it('deduplicates findings across scan reports', () => {
    const f = makeFinding({ file: 'src/a.ts', line: 5, finding: 'issue' });
    const r1: ScanReport = { filesScanned: [], findings: [f], summary: '' };
    const r2: ScanReport = { filesScanned: [], findings: [f], summary: '' };
    const report = fallbackAuditReport([r1, r2], 10);
    assert.equal(report.findings.length, 1);
  });

  it('counts critical and high correctly', () => {
    const findings = [
      makeFinding({ severity: 'critical', line: 1 }),
      makeFinding({ severity: 'critical', line: 2 }),
      makeFinding({ severity: 'high', line: 3 }),
    ];
    const report = fallbackAuditReport([{ filesScanned: [], findings, summary: '' }], 3);
    assert.equal(report.criticalCount, 2);
    assert.equal(report.highCount, 1);
  });

  it('sorts findings by severity descending', () => {
    const findings = [
      makeFinding({ severity: 'low', line: 1 }),
      makeFinding({ severity: 'critical', line: 2 }),
    ];
    const report = fallbackAuditReport([{ filesScanned: [], findings, summary: '' }], 2);
    assert.equal(report.findings[0]!.severity, 'critical');
  });
});

describe('recount', () => {
  it('recalculates criticalCount and highCount from findings', () => {
    const report = {
      findings: [
        makeFinding({ severity: 'critical' }),
        makeFinding({ severity: 'critical' }),
        makeFinding({ severity: 'high' }),
        makeFinding({ severity: 'low' }),
      ],
      criticalCount: 0,
      highCount: 0,
      totalFiles: 5,
      summary: '',
      topPriorities: [],
    };
    const result = recount(report);
    assert.equal(result.criticalCount, 2);
    assert.equal(result.highCount, 1);
  });
});

describe('FindingAggregator.deduplicate', () => {
  const noop = () => {};
  const agg = new FindingAggregator('/tmp', noop as never);

  it('removes exact duplicate file:line:category combinations', () => {
    const f = makeFinding({ file: 'a.ts', line: 10, category: 'security' });
    const result = agg.deduplicate([f, f]);
    assert.equal(result.length, 1);
  });

  it('keeps distinct line numbers as separate findings', () => {
    const f1 = makeFinding({ file: 'a.ts', line: 10 });
    const f2 = makeFinding({ file: 'a.ts', line: 20 });
    assert.equal(agg.deduplicate([f1, f2]).length, 2);
  });

  it('merges personas when deduplicating', () => {
    const f1 = makeFinding({ line: 5, persona: 'security' });
    const f2 = makeFinding({ line: 5, persona: 'bugs' });
    const result = agg.deduplicate([f1, f2]);
    assert.equal(result.length, 1);
    assert.ok(result[0]!.persona?.includes('security'));
    assert.ok(result[0]!.persona?.includes('bugs'));
  });

  it('keeps higher severity when merging duplicates', () => {
    const low = makeFinding({ line: 5, severity: 'low' });
    const crit = makeFinding({ line: 5, severity: 'critical' });
    const result = agg.deduplicate([low, crit]);
    assert.equal(result[0]!.severity, 'critical');
  });

  it('sorts output by severity descending', () => {
    const findings = [
      makeFinding({ line: 1, severity: 'low' }),
      makeFinding({ line: 2, severity: 'critical' }),
      makeFinding({ line: 3, severity: 'medium' }),
    ];
    const result = agg.deduplicate(findings);
    assert.equal(result[0]!.severity, 'critical');
    assert.equal(result[result.length - 1]!.severity, 'low');
  });
});
