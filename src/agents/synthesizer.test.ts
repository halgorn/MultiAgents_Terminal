import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthesizerAgent } from './synthesizer.js';
import type { SynthesizerInput } from './synthesizer.js';
import type { AuditFinding, ScanReport } from '../schemas/audit.js';

class TestSynthesizerAgent extends SynthesizerAgent {
  exposeMessage(input: SynthesizerInput): string {
    return (this as unknown as { buildUserMessage(i: SynthesizerInput): string }).buildUserMessage(input);
  }
  exposeParseOutput(text: string) {
    return (this as unknown as { parseOutput(t: string): unknown }).parseOutput(text);
  }
  exposeResolveState() {
    return (this as unknown as { resolveState(o: unknown): string }).resolveState({});
  }
}

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    file: 'src/app.ts',
    line: null,
    severity: 'high',
    category: 'security',
    finding: 'Hardcoded secret',
    recommendation: 'Use env var',
    ...overrides,
  };
}

function scanReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    filesScanned: ['src/app.ts'],
    findings: [finding()],
    summary: 'Found 1 issue',
    ...overrides,
  };
}

// ── buildUserMessage ──────────────────────────────────────────────────────────

test('SynthesizerAgent.buildUserMessage: includes Audit Digest header', () => {
  const agent = new TestSynthesizerAgent();
  const input: SynthesizerInput = {
    scanReports: [scanReport()],
    totalFiles: 5,
    worktreePath: '/tmp/repo',
  };
  const msg = agent.exposeMessage(input);
  assert.ok(msg.includes('Audit Digest'), 'should include digest header');
});

test('SynthesizerAgent.buildUserMessage: includes finding count and total files', () => {
  const agent = new TestSynthesizerAgent();
  const input: SynthesizerInput = {
    scanReports: [scanReport({ findings: [finding(), finding({ file: 'src/b.ts' })] })],
    totalFiles: 10,
    worktreePath: '/tmp/repo',
  };
  const msg = agent.exposeMessage(input);
  assert.ok(msg.includes('10'), 'should include totalFiles count');
});

test('SynthesizerAgent.buildUserMessage: deduplicates same file+line+category', () => {
  const agent = new TestSynthesizerAgent();
  const dup = finding({ file: 'src/app.ts', line: 5, category: 'security' });
  const input: SynthesizerInput = {
    scanReports: [
      scanReport({ findings: [dup] }),
      scanReport({ findings: [dup] }),
    ],
    totalFiles: 1,
    worktreePath: '/tmp/repo',
  };
  const msg = agent.exposeMessage(input);
  // Should deduplicate — count of HIGH lines should reflect 1 finding
  const highMatches = (msg.match(/Hardcoded secret/g) ?? []).length;
  assert.equal(highMatches, 1, 'duplicate findings should be merged');
});

test('SynthesizerAgent.buildUserMessage: includes domain coverage section', () => {
  const agent = new TestSynthesizerAgent();
  const input: SynthesizerInput = {
    scanReports: [scanReport({ findings: [finding({ category: 'security' })] })],
    totalFiles: 3,
    worktreePath: '/tmp/repo',
  };
  const msg = agent.exposeMessage(input);
  assert.ok(msg.includes('Domain coverage') || msg.includes('security'), 'should include domain breakdown');
});

// ── parseOutput ───────────────────────────────────────────────────────────────

test('SynthesizerAgent.parseOutput: valid JSON returns AuditReport shape', () => {
  const agent = new TestSynthesizerAgent();
  // First call buildUserMessage so mergedFindings is populated
  agent.exposeMessage({
    scanReports: [scanReport()],
    totalFiles: 1,
    worktreePath: '/tmp/repo',
  });
  const json = JSON.stringify({ summary: 'All clear.', topPriorities: ['Fix auth', 'Add tests'] });
  const result = agent.exposeParseOutput(json) as { summary: string; topPriorities: string[]; findings: unknown[] };
  assert.equal(result.summary, 'All clear.');
  assert.ok(Array.isArray(result.topPriorities));
  assert.ok(Array.isArray(result.findings));
});

test('SynthesizerAgent.parseOutput: missing summary throws schema error', () => {
  const agent = new TestSynthesizerAgent();
  agent.exposeMessage({ scanReports: [], totalFiles: 0, worktreePath: '/tmp' });
  assert.throws(
    () => agent.exposeParseOutput(JSON.stringify({ topPriorities: [] })),
    /schema error/i,
  );
});

// ── resolveState ──────────────────────────────────────────────────────────────

test('SynthesizerAgent.resolveState: always returns DONE', () => {
  const agent = new TestSynthesizerAgent();
  assert.equal(agent.exposeResolveState(), 'DONE');
});
