import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureGitignore } from './gitignore-guard.js';
import { AION_GITIGNORE_ENTRIES } from './paths.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'gitignore-guard-'));
}

test('ensureGitignore: creates .gitignore when none exists', () => {
  const dir = makeDir();
  try {
    assert.ok(!existsSync(join(dir, '.gitignore')), 'no .gitignore before');
    ensureGitignore(dir);
    assert.ok(existsSync(join(dir, '.gitignore')), '.gitignore should be created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignore: adds all aion entries to empty .gitignore', () => {
  const dir = makeDir();
  try {
    const { added } = ensureGitignore(dir);
    assert.equal(added.length, AION_GITIGNORE_ENTRIES.length, 'all entries should be added');
    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    for (const entry of AION_GITIGNORE_ENTRIES) {
      assert.ok(content.includes(entry), `missing entry: ${entry}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignore: skips entries already present', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, '.gitignore'), '.ai-runtime/\nnode_modules/\n');
    const { added, skipped } = ensureGitignore(dir);
    assert.ok(skipped.includes('.ai-runtime/'), '.ai-runtime/ should be skipped');
    assert.ok(!added.includes('.ai-runtime/'), '.ai-runtime/ should not be re-added');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignore: idempotent — second call adds nothing', () => {
  const dir = makeDir();
  try {
    ensureGitignore(dir);
    const { added } = ensureGitignore(dir);
    assert.equal(added.length, 0, 'second call should add nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignore: preserves existing .gitignore content', () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, '.gitignore'), 'dist/\n*.log\n');
    ensureGitignore(dir);
    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.ok(content.includes('dist/'), 'existing dist/ should be preserved');
    assert.ok(content.includes('*.log'), 'existing *.log should be preserved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignore: adds aion block markers to new gitignore', () => {
  const dir = makeDir();
  try {
    ensureGitignore(dir);
    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.ok(content.includes('# aion generated files'), 'should include block start marker');
    assert.ok(content.includes('# end aion'), 'should include block end marker');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignore: inserts missing entries into existing aion block', () => {
  const dir = makeDir();
  try {
    // Write a .gitignore with an existing aion block that is missing some entries
    writeFileSync(join(dir, '.gitignore'), '# aion generated files\n.ai-runtime/\n# end aion\n');
    const { added } = ensureGitignore(dir);
    assert.ok(added.length > 0, 'should add missing entries inside existing block');
    const content = readFileSync(join(dir, '.gitignore'), 'utf8');
    // Block markers should appear only once
    assert.equal((content.match(/# aion generated files/g) ?? []).length, 1, 'block start should appear once');
    assert.equal((content.match(/# end aion/g) ?? []).length, 1, 'block end should appear once');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
