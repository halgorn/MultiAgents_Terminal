import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeDbPii } from './db-pii-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'db-pii-analyzer-'));
}

test('analyzeDbPii: no schema/migration files → Visibility issue (low)', () => {
  const dir = makeDir();
  try {
    const result = analyzeDbPii(dir);
    const vis = result.issues.find((i) => i.area === 'Visibility');
    assert.ok(vis, 'should report Visibility issue when no schema/migration files exist');
    assert.equal(vis?.severity, 'low');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbPii: email/cpf columns without protection → PII exposure issue (high)', () => {
  const dir = makeDir();
  try {
    writeFileSync(
      join(dir, 'schema.prisma'),
      'model User {\n  id    Int    @id @default(autoincrement())\n  email String\n  cpf   String\n}\n',
    );
    const result = analyzeDbPii(dir);
    const piiIssue = result.issues.find((i) => i.area === 'PII exposure');
    assert.ok(piiIssue, 'should detect unprotected PII columns');
    assert.equal(piiIssue?.severity, 'high');
    assert.ok(result.unprotectedPiiSignals > 0);
    assert.ok(result.fields.includes('email'));
    assert.ok(result.fields.includes('cpf'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbPii: sensitive column with select:false → no PII exposure issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(
      join(dir, 'schema.prisma'),
      "model User {\n  id       Int    @id @default(autoincrement())\n  password String @db.VarChar(255)\n}\n\n// select: false, encrypted at rest\n",
    );
    const result = analyzeDbPii(dir);
    assert.equal(result.issues.find((i) => i.area === 'PII exposure'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbPii: score never drops below 0', () => {
  const dir = makeDir();
  try {
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(dir, `migration_${i}.py`), 'email = models.CharField()\ncpf = models.CharField()\n');
    }
    const result = analyzeDbPii(dir);
    assert.ok(result.score >= 0, `score should be >= 0, got ${result.score}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
