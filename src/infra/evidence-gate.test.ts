import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuditFinding } from '../schemas/audit.js';
import type { RepoIndex } from './repo-index.js';
import { validateAuditFindings } from './evidence-gate.js';

const baseFinding: AuditFinding = {
  file: 'src/app.ts',
  line: 1,
  severity: 'low',
  category: 'testing',
  finding: 'Missing test.',
  recommendation: 'Add test.',
};

const index: RepoIndex = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  root: '/repo',
  files: [{ path: 'src/app.ts', ext: '.ts', loc: 10, bytes: 100, isTest: false }],
  symbols: [],
  imports: [],
  chunks: [],
  tests: [],
  stats: { files: 1, symbols: 0, imports: 0, chunks: 0, testLinks: 0 },
};

test('validateAuditFindings accepts indexed file and line', () => {
  const result = validateAuditFindings([baseFinding], index);

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 0);
});

test('validateAuditFindings rejects missing files and impossible lines', () => {
  const result = validateAuditFindings([
    { ...baseFinding, file: 'missing.ts' },
    { ...baseFinding, line: 99 },
  ], index);

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 2);
});
