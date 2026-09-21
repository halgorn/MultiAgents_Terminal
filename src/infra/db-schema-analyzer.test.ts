import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeDbSchema } from './db-schema-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'db-schema-analyzer-'));
}

test('analyzeDbSchema: no schema files → Visibility issue (low)', () => {
  const dir = makeDir();
  try {
    const result = analyzeDbSchema(dir);
    const vis = result.issues.find((i) => i.area === 'Visibility');
    assert.ok(vis, 'should report Visibility issue when no schema files exist');
    assert.equal(vis?.severity, 'low');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbSchema: Prisma FK without @@index → Indexes issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(
      join(dir, 'schema.prisma'),
      `model Post {\n  id       Int    @id @default(autoincrement())\n  authorId Int\n  author   User   @relation(fields: [authorId], references: [id])\n}\n\nmodel User {\n  id Int @id @default(autoincrement())\n}\n`,
    );
    const result = analyzeDbSchema(dir);
    const idxIssue = result.issues.find((i) => i.area === 'Indexes');
    assert.ok(idxIssue, 'should detect FK without index');
    assert.ok(result.fkWithoutIndexSignals > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbSchema: Prisma FK with @@index → no Indexes issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(
      join(dir, 'schema.prisma'),
      `model Post {\n  id       Int    @id @default(autoincrement())\n  authorId Int\n  author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)\n\n  @@index([authorId])\n}\n`,
    );
    const result = analyzeDbSchema(dir);
    assert.equal(result.issues.find((i) => i.area === 'Indexes'), undefined);
    assert.equal(result.issues.find((i) => i.area === 'Referential integrity'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbSchema: model without @id → Primary keys issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'schema.prisma'), 'model Log {\n  message String\n}\n');
    const result = analyzeDbSchema(dir);
    const pkIssue = result.issues.find((i) => i.area === 'Primary keys');
    assert.ok(pkIssue, 'should detect missing primary key');
    assert.equal(pkIssue?.severity, 'high');
    assert.ok(result.tableWithoutPkSignals > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbSchema: email field without @unique → Uniqueness issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'schema.prisma'), 'model User {\n  id    Int    @id @default(autoincrement())\n  email String\n}\n');
    const result = analyzeDbSchema(dir);
    const uniqIssue = result.issues.find((i) => i.area === 'Uniqueness');
    assert.ok(uniqIssue, 'should detect email field without unique constraint');
    assert.ok(result.missingUniqueSignals > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbSchema: score never drops below 0', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'schema.prisma'), 'model Log {\n  email String\n  cpf   String\n}\n');
    const result = analyzeDbSchema(dir);
    assert.ok(result.score >= 0, `score should be >= 0, got ${result.score}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
