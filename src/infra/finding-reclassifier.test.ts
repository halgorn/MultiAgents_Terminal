import test from 'node:test';
import assert from 'node:assert/strict';
import { reclassifyFindings, reclassStats, formatReclassNote } from './finding-reclassifier.js';
import type { AuditFinding } from '../schemas/audit.js';
import type { ProjectIdentity } from './project-identity.js';

function makeIdentity(primary_type: ProjectIdentity['primary_type']): ProjectIdentity {
  return {
    primary_type,
    secondary_types: [],
    execution_model: 'local',
    confidence: 90,
    trust_boundaries: {
      trusted: ['config files'],
      semi_trusted: ['CLI args'],
      untrusted: ['user input'],
    },
    signals: [],
  };
}

function makeFinding(severity: AuditFinding['severity'], finding: string): AuditFinding {
  return { file: 'src/foo.ts', line: 10, severity, category: 'security', finding, recommendation: '' };
}

// ── cli_tool reclassification ────────────────────────────────────────────────

test('reclassify: execSync critical → medium in cli_tool', () => {
  const findings = [makeFinding('critical', 'execSync called with user input — command injection risk')];
  const result = reclassifyFindings(findings, makeIdentity('cli_tool'));
  assert.equal(result[0]!.severity, 'medium');
  assert.equal((result[0] as AuditFinding & { rawSeverity?: string }).rawSeverity, 'critical');
});

test('reclassify: spawn high → low in cli_tool', () => {
  const findings = [makeFinding('high', 'spawn() usage without sanitization')];
  const result = reclassifyFindings(findings, makeIdentity('cli_tool'));
  assert.equal(result[0]!.severity, 'low');
});

test('reclassify: innerHTML critical → info in cli_tool (no browser context)', () => {
  const findings = [makeFinding('critical', 'innerHTML used with unsanitized content')];
  const result = reclassifyFindings(findings, makeIdentity('cli_tool'));
  assert.equal(result[0]!.severity, 'info');
});

test('reclassify: process.env high → info in cli_tool', () => {
  const findings = [makeFinding('high', 'process.env.API_KEY exposed to logs')];
  const result = reclassifyFindings(findings, makeIdentity('cli_tool'));
  assert.equal(result[0]!.severity, 'info');
});

test('reclassify: CSRF critical → low in cli_tool (no browser session)', () => {
  const findings = [makeFinding('critical', 'CSRF token missing on state-changing endpoint')];
  const result = reclassifyFindings(findings, makeIdentity('cli_tool'));
  assert.equal(result[0]!.severity, 'low');
});

// ── multi_agent_framework reclassification ───────────────────────────────────

test('reclassify: spawn critical → medium in multi_agent_framework', () => {
  const findings = [makeFinding('critical', 'spawn() used in agent executor without validation')];
  const result = reclassifyFindings(findings, makeIdentity('multi_agent_framework'));
  assert.equal(result[0]!.severity, 'medium');
});

test('reclassify: api_key medium → info in multi_agent_framework (expected pattern)', () => {
  const findings = [makeFinding('medium', 'api_key read from process.env in agent runner')];
  const result = reclassifyFindings(findings, makeIdentity('multi_agent_framework'));
  assert.equal(result[0]!.severity, 'info');
});

test('reclassify: XSS not downgraded in web_app', () => {
  const findings = [makeFinding('critical', 'innerHTML used with user data — XSS risk')];
  const result = reclassifyFindings(findings, makeIdentity('web_app'));
  assert.equal(result[0]!.severity, 'critical', 'XSS in web_app should stay critical');
});

// ── no severity upgrade ───────────────────────────────────────────────────────

test('reclassify: never upgrades severity', () => {
  const findings = [makeFinding('info', 'execSync found in source')];
  const result = reclassifyFindings(findings, makeIdentity('cli_tool'));
  assert.equal(result[0]!.severity, 'info', 'info should not be upgraded');
});

// ── contextNote is set ────────────────────────────────────────────────────────

test('reclassify: contextNote is set when reclassification occurs', () => {
  const findings = [makeFinding('critical', 'execSync with unsanitized input')];
  const result = reclassifyFindings(findings, makeIdentity('cli_tool'));
  const note = (result[0] as AuditFinding & { contextNote?: string }).contextNote;
  assert.ok(typeof note === 'string' && note.length > 0, 'contextNote should be set');
});

// ── reclassStats ─────────────────────────────────────────────────────────────

test('reclassStats: counts changed correctly', () => {
  const before = [
    makeFinding('critical', 'execSync'),
    makeFinding('high', 'sql injection'),
  ];
  const identity = makeIdentity('cli_tool');
  const after = reclassifyFindings(before, identity);
  const stats = reclassStats(before, after);
  assert.ok(stats.changed >= 1);
  assert.equal(stats.total, 2);
});

test('reclassStats: no changes when nothing matches', () => {
  const before = [makeFinding('critical', 'hardcoded password in source')];
  const after = reclassifyFindings(before, makeIdentity('cli_tool'));
  const stats = reclassStats(before, after);
  assert.equal(stats.changed, 0);
});

// ── formatReclassNote ─────────────────────────────────────────────────────────

test('formatReclassNote: empty string when nothing changed', () => {
  const note = formatReclassNote({ total: 5, changed: 0, byTransition: {} });
  assert.equal(note, '');
});

test('formatReclassNote: describes transition when changes occur', () => {
  const note = formatReclassNote({ total: 5, changed: 2, byTransition: { 'critical→medium': 2 } });
  assert.ok(note.includes('2/5'));
  assert.ok(note.includes('critical→medium'));
});
