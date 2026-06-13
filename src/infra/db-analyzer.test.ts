import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeDatabase } from './db-analyzer.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'db-analyzer-'));
}

// ── no database signal ────────────────────────────────────────────────────────

test('analyzeDatabase: empty dir reports "No strong database signal" (low)', () => {
  const dir = makeDir();
  try {
    const result = analyzeDatabase(dir);
    const vis = result.issues.find((i) => i.area === 'Visibility');
    assert.ok(vis, 'should report Visibility issue for no-DB project');
    assert.equal(vis?.severity, 'low');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── ORM detection ─────────────────────────────────────────────────────────────

test('analyzeDatabase: @prisma/client import → Prisma in ormSignals', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'client.ts'), "import { PrismaClient } from '@prisma/client';\nconst db = new PrismaClient();\n");
    const result = analyzeDatabase(dir);
    assert.ok(result.ormSignals.includes('Prisma'), `expected Prisma in ormSignals, got: ${result.ormSignals.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── migration detection ───────────────────────────────────────────────────────

test('analyzeDatabase: prisma client with no migrations dir → Schema lifecycle issue', () => {
  const dir = makeDir();
  try {
    // Use client.ts (not schema.prisma) so it doesn't count as migrationFiles
    writeFileSync(join(dir, 'client.ts'), "import { PrismaClient } from '@prisma/client';\nconst db = new PrismaClient();\n");
    const result = analyzeDatabase(dir);
    const migIssue = result.issues.find((i) => i.area === 'Schema lifecycle');
    assert.ok(migIssue, 'should report missing migration issue');
    assert.equal(migIssue?.severity, 'high');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDatabase: migrations/ directory removes Schema lifecycle issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'client.ts'), "import { PrismaClient } from '@prisma/client';\nconst db = new PrismaClient();\n");
    mkdirSync(join(dir, 'migrations'), { recursive: true });
    const result = analyzeDatabase(dir);
    const migIssue = result.issues.find((i) => i.area === 'Schema lifecycle');
    assert.equal(migIssue, undefined, 'no migration issue when migrations/ dir exists');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── raw SQL signals ───────────────────────────────────────────────────────────

test('analyzeDatabase: file with SELECT without index signals → Indexes issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'repo.ts'), "const rows = await db.execute('SELECT * FROM users WHERE email = $1');\n");
    const result = analyzeDatabase(dir);
    const indexIssue = result.issues.find((i) => i.area === 'Indexes');
    assert.ok(indexIssue, 'should detect missing index signal');
    assert.ok(result.rawSqlFiles > 0, 'rawSqlFiles should be > 0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── unbounded list signals ────────────────────────────────────────────────────

test('analyzeDatabase: findMany without LIMIT → unbounded list issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'repo.ts'), 'const users = await prisma.user.findMany();\n');
    const result = analyzeDatabase(dir);
    const listIssue = result.issues.find((i) => i.area === 'List growth');
    assert.ok(listIssue, 'should report unbounded list issue');
    assert.ok(result.unboundedListSignals > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDatabase: findMany with take: removes unbounded list issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'repo.ts'), 'const users = await prisma.user.findMany({ take: 20 });\n');
    const result = analyzeDatabase(dir);
    const listIssue = result.issues.find((i) => i.area === 'List growth');
    assert.equal(listIssue, undefined, 'no unbounded list issue when take: is present');
    assert.ok(result.paginationSignals > 0, 'take: should count as pagination signal');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── score ─────────────────────────────────────────────────────────────────────

test('analyzeDatabase: score never drops below 0', () => {
  const dir = makeDir();
  try {
    // Multiple violations
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(dir, `repo${i}.ts`), `db.execute('SELECT * FROM table${i}');\nfindMany();\n`);
    }
    const result = analyzeDatabase(dir);
    assert.ok(result.score >= 0, `score should be ≥ 0, got ${result.score}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
