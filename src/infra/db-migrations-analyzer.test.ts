import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeDbMigrations } from './db-migrations-analyzer.js';

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'db-migrations-analyzer-'));
  mkdirSync(join(dir, 'migrations'));
  return dir;
}

test('analyzeDbMigrations: no migration files → Visibility issue (low)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'db-migrations-analyzer-'));
  try {
    const result = analyzeDbMigrations(dir);
    const vis = result.issues.find((i) => i.area === 'Visibility');
    assert.ok(vis, 'should report Visibility issue when no migration files exist');
    assert.equal(vis?.severity, 'low');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbMigrations: DROP COLUMN → Destructive changes issue (high)', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'migrations', '001_migration.sql'), 'ALTER TABLE users DROP COLUMN legacy_field;\n');
    const result = analyzeDbMigrations(dir);
    const dropIssue = result.issues.find((i) => i.area === 'Destructive changes');
    assert.ok(dropIssue, 'should detect DROP COLUMN');
    assert.equal(dropIssue?.severity, 'high');
    assert.ok(result.dropColumnSignals > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbMigrations: FK without index → Indexes issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'migrations', '002_migration.sql'), 'ALTER TABLE posts ADD CONSTRAINT fk_author FOREIGN KEY (author_id) REFERENCES users(id);\n');
    const result = analyzeDbMigrations(dir);
    const idxIssue = result.issues.find((i) => i.area === 'Indexes');
    assert.ok(idxIssue, 'should detect FK without index');
    assert.ok(result.fkWithoutIndexSignals > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbMigrations: up() with no down() → Reversibility issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, 'migrations', '003_migration.js'), 'exports.up = function (knex) { return knex.schema.createTable("t", () => {}); };\n');
    const result = analyzeDbMigrations(dir);
    const revIssue = result.issues.find((i) => i.area === 'Reversibility');
    assert.ok(revIssue, 'should detect missing down()');
    assert.ok(result.irreversibleSignals > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbMigrations: up()/down() pair present → no Reversibility issue', () => {
  const dir = makeDir();
  try {
    writeFileSync(
      join(dir, 'migrations', '004_migration.js'),
      'exports.up = function (knex) { return knex.schema.createTable("t", () => {}); };\nexports.down = function (knex) { return knex.schema.dropTable("t"); };\n',
    );
    const result = analyzeDbMigrations(dir);
    assert.equal(result.issues.find((i) => i.area === 'Reversibility'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('analyzeDbMigrations: score never drops below 0', () => {
  const dir = makeDir();
  try {
    writeFileSync(
      join(dir, 'migrations', '005_migration.sql'),
      'ALTER TABLE users DROP COLUMN a;\nALTER TABLE posts ADD CONSTRAINT fk FOREIGN KEY (author_id) REFERENCES users(id);\nALTER TABLE posts ADD COLUMN status VARCHAR(20) NOT NULL;\n',
    );
    const result = analyzeDbMigrations(dir);
    assert.ok(result.score >= 0, `score should be >= 0, got ${result.score}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
