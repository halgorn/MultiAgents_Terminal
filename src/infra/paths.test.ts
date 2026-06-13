import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_RUNTIME_DIR,
  WORKTREES_DIR,
  AION_CONFIG_FILE,
  AION_IGNORE_FILE,
  AION_GITIGNORE_ENTRIES,
} from './paths.js';

test('AI_RUNTIME_DIR is .ai-runtime', () => {
  assert.equal(AI_RUNTIME_DIR, '.ai-runtime');
});

test('WORKTREES_DIR is .worktrees', () => {
  assert.equal(WORKTREES_DIR, '.worktrees');
});

test('AION_CONFIG_FILE is .aionrc.json', () => {
  assert.equal(AION_CONFIG_FILE, '.aionrc.json');
});

test('AION_IGNORE_FILE is .aionignore', () => {
  assert.equal(AION_IGNORE_FILE, '.aionignore');
});

test('AION_GITIGNORE_ENTRIES contains 17 entries', () => {
  assert.equal(AION_GITIGNORE_ENTRIES.length, 17);
});

test('AION_GITIGNORE_ENTRIES includes runtime dirs', () => {
  assert.ok(AION_GITIGNORE_ENTRIES.includes('.ai-runtime/'));
  assert.ok(AION_GITIGNORE_ENTRIES.includes('.ai-memory/'));
  assert.ok(AION_GITIGNORE_ENTRIES.includes('.worktrees/'));
});

test('AION_GITIGNORE_ENTRIES includes generated JSON files', () => {
  assert.ok(AION_GITIGNORE_ENTRIES.includes('repo-vectors.json'));
  assert.ok(AION_GITIGNORE_ENTRIES.includes('repo-index.json'));
  assert.ok(AION_GITIGNORE_ENTRIES.includes('dep-graph.json'));
  assert.ok(AION_GITIGNORE_ENTRIES.includes('audit-cache.json'));
  assert.ok(AION_GITIGNORE_ENTRIES.includes('health-trend.json'));
  assert.ok(AION_GITIGNORE_ENTRIES.includes('session-budget.json'));
  assert.ok(AION_GITIGNORE_ENTRIES.includes('setup-state.json'));
});

test('AION_GITIGNORE_ENTRIES entries are all strings and non-empty', () => {
  for (const entry of AION_GITIGNORE_ENTRIES) {
    assert.equal(typeof entry, 'string');
    assert.ok(entry.length > 0, `empty entry found`);
  }
});

test('AION_GITIGNORE_ENTRIES has no duplicate entries', () => {
  const unique = new Set(AION_GITIGNORE_ENTRIES);
  assert.equal(unique.size, AION_GITIGNORE_ENTRIES.length, 'duplicate entries detected');
});

test('AION_GITIGNORE_ENTRIES does not contain source or config files', () => {
  const forbidden = ['.aionrc.json', 'package.json', 'tsconfig.json', 'src/', 'dist/'];
  for (const bad of forbidden) {
    assert.ok(!AION_GITIGNORE_ENTRIES.includes(bad), `unexpected entry: ${bad}`);
  }
});
