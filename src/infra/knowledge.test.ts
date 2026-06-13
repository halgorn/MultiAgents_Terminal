import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KnowledgeStore } from './knowledge.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'knowledge-'));
}

// ── writeEntry + readCategory ─────────────────────────────────────────────────

test('writeEntry: creates file and returns path', () => {
  const dir = makeDir();
  try {
    const store = new KnowledgeStore(dir);
    const path = store.writeEntry('architecture', 'Auth Design', 'JWT used for stateless sessions.');
    assert.ok(path.endsWith('.md'));
    const content = store.readCategory('architecture');
    assert.ok(content.includes('Auth Design'));
    assert.ok(content.includes('JWT used for stateless sessions.'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeEntry: slug replaces spaces and special chars', () => {
  const dir = makeDir();
  try {
    const store = new KnowledgeStore(dir);
    const path = store.writeEntry('decisions', 'API Rate-Limiting Strategy!', 'Use token bucket.');
    // slug should not have spaces or ! in filename
    assert.ok(!path.includes(' '));
    assert.ok(!path.includes('!'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readCategory: returns empty string when no entries', () => {
  const dir = makeDir();
  try {
    const store = new KnowledgeStore(dir);
    assert.equal(store.readCategory('architecture'), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readCategory: concatenates multiple entries with separator', () => {
  const dir = makeDir();
  try {
    const store = new KnowledgeStore(dir);
    store.writeEntry('architecture', 'Entry One', 'Content one.');
    store.writeEntry('architecture', 'Entry Two', 'Content two.');
    const content = store.readCategory('architecture');
    assert.ok(content.includes('Content one.'));
    assert.ok(content.includes('Content two.'));
    assert.ok(content.includes('---'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── buildContext ──────────────────────────────────────────────────────────────

test('buildContext: returns relevant entry for matching query', () => {
  const dir = makeDir();
  try {
    const store = new KnowledgeStore(dir);
    store.writeEntry('architecture', 'Auth Module', 'JWT authentication with refresh tokens.');
    store.writeEntry('decisions', 'Database Choice', 'PostgreSQL for relational data.');
    const context = store.buildContext('authentication JWT tokens');
    assert.ok(context.includes('Auth Module') || context.includes('JWT'), `context should include auth entry, got: ${context.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildContext: returns empty string when no entries exist', () => {
  const dir = makeDir();
  try {
    const store = new KnowledgeStore(dir);
    const context = store.buildContext('anything');
    assert.equal(context.trim(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildContext: does not exceed context char limit', async () => {
  const dir = makeDir();
  try {
    const store = new KnowledgeStore(dir);
    // Write many large entries
    for (let i = 0; i < 20; i++) {
      store.writeEntry('architecture', `Module ${i}`, 'x'.repeat(5000));
    }
    const context = store.buildContext('module');
    // Context limit is 12000 chars by default
    assert.ok(context.length <= 15000, `context too long: ${context.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
