import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseSemgrepOutput, semgrepProcessEnv } from './semgrep.js';

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

test('parseSemgrepOutput downgrades local CLI path traversal findings to medium', () => {
  const result = parseSemgrepOutput(JSON.stringify({
    paths: { scanned: ['src/cli/commands/context.ts'] },
    results: [{
      check_id: 'javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal',
      path: 'src/cli/commands/context.ts',
      start: { line: 11 },
      extra: {
        message: 'Detected possible user input going into path.join',
        severity: 'WARNING',
        metadata: { category: 'security' },
      },
    }],
  }));

  assert.equal(result.findings[0]?.severity, 'medium');
  assert.equal(result.findings[0]?.category, 'security');
});


test('parseSemgrepOutput reports invalid JSON clearly', () => {
  const result = parseSemgrepOutput('{not json');

  assert.equal(result.available, true);
  assert.equal(result.filesScanned, 0);
  assert.equal(result.findings.length, 0);
  assert.equal(result.error, 'failed to parse semgrep output');
});

test('parseSemgrepOutput accepts Semgrep status text around JSON', () => {
  const result = parseSemgrepOutput(`Scan Status
{"paths":{"scanned":["a.py"]},"results":[]}
Scan Summary`);

  assert.equal(result.available, true);
  assert.equal(result.filesScanned, 1);
  assert.equal(result.findings.length, 0);
});

test('parseSemgrepOutput respects nearby nosemgrep comments when cwd is provided', () => {
  const dir = mkdtempSync(join(tmpdir(), 'semgrep-nosemgrep-'));
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/app.ts'), [
      'function run(command: string) {',
      '  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process',
      '  return command;',
      '}',
    ].join('\n'));

    const result = parseSemgrepOutput(JSON.stringify({
      paths: { scanned: ['src/app.ts'] },
      results: [{
        check_id: 'javascript.lang.security.detect-child-process.detect-child-process',
        path: 'src/app.ts',
        start: { line: 3 },
        extra: {
          message: 'Detected child process',
          severity: 'ERROR',
          metadata: { category: 'security' },
        },
      }],
    }), dir);

    assert.equal(result.findings.length, 0);
    assert.equal(result.filesScanned, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('semgrepProcessEnv excludes provider and cloud credentials', () => {
  const oldAnthropic = process.env['ANTHROPIC_API_KEY'];
  const oldAws = process.env['AWS_ACCESS_KEY_ID'];
  process.env['ANTHROPIC_API_KEY'] = 'secret';
  process.env['AWS_ACCESS_KEY_ID'] = 'cloud-secret';

  try {
    const env = semgrepProcessEnv();

    assert.equal(env['ANTHROPIC_API_KEY'], undefined);
    assert.equal(env['AWS_ACCESS_KEY_ID'], undefined);
    assert.equal(Object.hasOwn(env, 'ANTHROPIC_API_KEY'), false);
  } finally {
    if (oldAnthropic === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = oldAnthropic;
    if (oldAws === undefined) delete process.env['AWS_ACCESS_KEY_ID'];
    else process.env['AWS_ACCESS_KEY_ID'] = oldAws;
  }
});
