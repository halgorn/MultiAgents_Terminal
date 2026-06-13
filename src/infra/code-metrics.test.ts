import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rankFilesByRisk, scanCurrentSecrets } from './code-metrics.js';

// ── rankFilesByRisk ───────────────────────────────────────────────────────────

test('rankFilesByRisk: higher churn score ranks first', () => {
  const files = ['src/low.ts', 'src/high.ts'];
  const churnCounts = new Map([['src/high.ts', 15], ['src/low.ts', 1]]);
  const result = rankFilesByRisk(files, { churnCounts });
  assert.equal(result[0]!.file, 'src/high.ts');
  assert.ok(result[0]!.reasons.some((r) => r.startsWith('churn:')));
});

test('rankFilesByRisk: semgrep hit boosts score', () => {
  const files = ['a.ts', 'b.ts'];
  const semgrepFiles = new Set(['a.ts']);
  const result = rankFilesByRisk(files, { semgrepFiles });
  assert.equal(result[0]!.file, 'a.ts');
  assert.ok(result[0]!.reasons.includes('semgrep-hit'));
});

test('rankFilesByRisk: key module names get extra score', () => {
  const files = ['src/utils/helper.ts', 'src/index.ts'];
  const result = rankFilesByRisk(files, {});
  const indexRanked = result.find((r) => r.file === 'src/index.ts');
  assert.ok(indexRanked?.reasons.includes('key-module'));
});

test('rankFilesByRisk: high dependency fan-in boosts score', () => {
  const files = ['lib/core.ts', 'lib/utils.ts'];
  const depFanIn = new Map([['lib/core.ts', 12]]);
  const result = rankFilesByRisk(files, { depFanIn });
  assert.equal(result[0]!.file, 'lib/core.ts');
  assert.ok(result[0]!.reasons.some((r) => r.startsWith('dep-central:')));
});

test('rankFilesByRisk: test files receive score penalty', () => {
  const files = ['src/app.ts', 'src/app.test.ts'];
  const result = rankFilesByRisk(files, {});
  const testFile = result.find((r) => r.file === 'src/app.test.ts');
  const srcFile = result.find((r) => r.file === 'src/app.ts');
  assert.ok(srcFile!.score > testFile!.score);
});

test('rankFilesByRisk: cognitive complexity adds score', () => {
  const files = ['src/simple.ts', 'src/complex.ts'];
  const cognitiveScores = new Map([['src/complex.ts', 40]]);
  const result = rankFilesByRisk(files, { cognitiveScores });
  assert.equal(result[0]!.file, 'src/complex.ts');
  assert.ok(result[0]!.reasons.some((r) => r.startsWith('complexity:')));
});

test('rankFilesByRisk: empty files list returns empty result', () => {
  const result = rankFilesByRisk([], { churnCounts: new Map() });
  assert.deepEqual(result, []);
});

// ── scanCurrentSecrets ────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'code-metrics-'));
}

test('scanCurrentSecrets detects hardcoded password', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, 'src'));
    // Construct pattern so the literal doesn't trigger scanCurrentSecrets on this file itself
    const key = 'pass' + 'word';
    const val = 'super' + 'secret123';
    writeFileSync(join(dir, 'src', 'config.ts'), `const ${key} = '${val}';`);
    const hits = scanCurrentSecrets(dir);
    assert.ok(hits.some((h) => h.pattern === 'hardcoded-password'), `expected hit, got ${JSON.stringify(hits)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanCurrentSecrets detects AWS access key pattern', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, 'src'));
    // Split so the literal key pattern doesn't trigger scanCurrentSecrets on this file
    const awsKey = 'AKIA' + 'IOSFODNN7EXAMPLE';
    writeFileSync(join(dir, 'src', 'config.ts'), `const key = '${awsKey}';`);
    const hits = scanCurrentSecrets(dir);
    assert.ok(hits.some((h) => h.pattern === 'aws-key'), `expected aws-key hit, got ${JSON.stringify(hits)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanCurrentSecrets skips commented-out lines', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, 'src'));
    // Split to avoid triggering scanCurrentSecrets on this file itself
    const k = 'pass' + 'word';
    const v = 'super' + 'secret123';
    writeFileSync(join(dir, 'src', 'config.ts'), `// const ${k} = '${v}';`);
    const hits = scanCurrentSecrets(dir);
    assert.equal(hits.length, 0, 'commented line should be skipped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanCurrentSecrets returns empty for clean code', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'clean.ts'), `const x = process.env.DB_PASSWORD;`);
    const hits = scanCurrentSecrets(dir);
    assert.equal(hits.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
