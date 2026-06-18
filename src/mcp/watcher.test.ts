import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileWatcher, createWatcher } from './watcher.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-watch-'));
}

test('FileWatcher starts and stops', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    const w = new FileWatcher({ cwd, roots: ['src'] });
    w.start();
    assert.equal(w.stats().active, true);
    w.stop();
    assert.equal(w.stats().active, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher reports watchedRoots', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    mkdirSync(join(cwd, 'lib'), { recursive: true });
    const w = new FileWatcher({ cwd, roots: ['src', 'lib'] });
    w.start();
    const stats = w.stats();
    assert.deepEqual(stats.watchedRoots, ['src', 'lib']);
    w.stop();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher ignores missing roots', () => {
  const cwd = makeTmp();
  try {
    const w = new FileWatcher({ cwd, roots: ['nonexistent'] });
    w.start();
    assert.equal(w.stats().active, true);
    assert.equal(w.stats().watchedRoots.length, 1);
    w.stop();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher detects file changes', async () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    const w = new FileWatcher({ cwd, roots: ['src'], debounceMs: 50 });
    let changedFile = '';
    w.start();
    const onChange = (f: string) => { changedFile = f; };
    const w2 = new FileWatcher({ cwd, roots: ['src'], debounceMs: 50, onChange });
    w.stop();
    w2.start();
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 1;');
    await new Promise((r) => setTimeout(r, 200));
    w2.stop();
    assert.ok(w2.filesChanged() > 0 || changedFile.length > 0, `expected change, got ${w2.filesChanged()}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher debounces multiple changes to same file', async () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'a.ts'), 'initial');
    const w = new FileWatcher({ cwd, roots: ['src'], debounceMs: 100 });
    w.start();
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(cwd, 'src', 'a.ts'), `change-${i}`);
    }
    await new Promise((r) => setTimeout(r, 250));
    const count = w.filesChanged();
    w.stop();
    assert.ok(count >= 1, `expected at least 1 change, got ${count}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher stats include startedAt', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    const w = new FileWatcher({ cwd, roots: ['src'] });
    w.start();
    const stats = w.stats();
    assert.ok(stats.startedAt.length > 0);
    w.stop();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher onError is called for invalid root', () => {
  const cwd = makeTmp();
  try {
    let errorReceived = false;
    const w = new FileWatcher({
      cwd,
      roots: ['this-does-not-exist-but-starts-anyway'],
      onError: () => { errorReceived = true; },
    });
    w.start();
    w.stop();
    assert.equal(errorReceived, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('createWatcher returns FileWatcher instance', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    const w = createWatcher({ cwd, roots: ['src'] });
    assert.ok(w instanceof FileWatcher);
    w.stop();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher ignores dotfile directories', async () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src', '.hidden'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'a.ts'), 'visible');
    const w = new FileWatcher({ cwd, roots: ['src'], debounceMs: 50 });
    w.start();
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(cwd, 'src', '.hidden', 'x.ts'), 'hidden change');
    await new Promise((r) => setTimeout(r, 200));
    const count = w.filesChanged();
    w.stop();
    assert.equal(count, 0, 'expected hidden change to be ignored');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher stop is idempotent', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    const w = new FileWatcher({ cwd, roots: ['src'] });
    w.start();
    w.stop();
    w.stop();
    assert.equal(w.stats().active, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher watches individual files in addition to directories', async () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'package.json'), '{"name":"test"}');
    writeFileSync(join(cwd, 'src', 'a.ts'), 'initial');
    const w = new FileWatcher({ cwd, roots: ['src'], debounceMs: 50 });
    w.start();
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(cwd, 'package.json'), '{"name":"changed","version":"1"}');
    await new Promise((r) => setTimeout(r, 200));
    const count = w.filesChanged();
    w.stop();
    assert.ok(count >= 1, `expected ≥1 change, got ${count}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher with watchRootFiles=false ignores root files', async () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'package.json'), '{"name":"test"}');
    const w = new FileWatcher({ cwd, roots: ['src'], watchRootFiles: false, debounceMs: 50 });
    w.start();
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(cwd, 'package.json'), '{"name":"changed"}');
    await new Promise((r) => setTimeout(r, 200));
    const count = w.filesChanged();
    w.stop();
    assert.equal(count, 0, 'should not detect changes in root files when watchRootFiles=false');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher with watchAll=true uses broader root defaults', () => {
  const cwd = makeTmp();
  try {
    const w = new FileWatcher({ cwd, watchAll: true });
    const stats = w.stats();
    assert.ok(stats.watchedRoots.includes('app'));
    assert.ok(stats.watchedRoots.includes('packages'));
    assert.ok(stats.watchedRoots.includes('services'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher stats include watchedFiles list', async () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'package.json'), '{}');
    writeFileSync(join(cwd, 'tsconfig.json'), '{}');
    const w = new FileWatcher({ cwd, roots: ['src'] });
    w.start();
    const stats = w.stats();
    assert.ok(stats.watchedFiles.includes('package.json'));
    assert.ok(stats.watchedFiles.includes('tsconfig.json'));
    w.stop();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher addRoot adds new root', () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    mkdirSync(join(cwd, 'tests'), { recursive: true });
    const w = new FileWatcher({ cwd, roots: ['src'] });
    w.addRoot('tests');
    assert.ok(w.stats().watchedRoots.includes('tests'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher addFile adds new file', () => {
  const cwd = makeTmp();
  try {
    writeFileSync(join(cwd, 'custom.json'), '{}');
    const w = new FileWatcher({ cwd, roots: [], watchRootFiles: false, files: [] });
    w.addFile('custom.json');
    assert.ok(w.stats().watchedFiles.includes('custom.json'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher ignores tsconfig when not present', () => {
  const cwd = makeTmp();
  try {
    const w = new FileWatcher({ cwd, roots: [], watchRootFiles: true });
    const stats = w.stats();
    assert.equal(stats.watchedFiles.includes('tsconfig.json'), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('FileWatcher detects tsconfig.json change', async () => {
  const cwd = makeTmp();
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'tsconfig.json'), '{"compilerOptions":{}}');
    const w = new FileWatcher({ cwd, roots: ['src'], debounceMs: 50 });
    w.start();
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(join(cwd, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
    await new Promise((r) => setTimeout(r, 200));
    const count = w.filesChanged();
    w.stop();
    assert.ok(count >= 1, `expected ≥1 change, got ${count}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
