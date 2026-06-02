import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSemgrepOutput } from './semgrep.js';

test('parseSemgrepOutput maps findings and scanned paths', () => {
  const result = parseSemgrepOutput(JSON.stringify({
    paths: { scanned: ['src/app.ts', 'src/auth.ts'] },
    results: [{
      check_id: 'typescript.express.security.audit.xss',
      path: 'src/app.ts',
      start: { line: 42 },
      extra: {
        message: 'Potential XSS',
        severity: 'WARNING',
        metadata: { category: 'security' },
      },
    }],
  }));

  assert.equal(result.available, true);
  assert.equal(result.filesScanned, 2);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.severity, 'high');
  assert.equal(result.findings[0]?.category, 'security');
});

test('parseSemgrepOutput reports invalid JSON clearly', () => {
  const result = parseSemgrepOutput('{not json');

  assert.equal(result.available, true);
  assert.equal(result.filesScanned, 0);
  assert.equal(result.findings.length, 0);
  assert.equal(result.error, 'failed to parse semgrep output');
});
