import test from 'node:test';
import assert from 'node:assert/strict';
import { isIgnoredDirName, isGeneratedArtifact, SOURCE_EXTS, IGNORE_DIRS } from './file-filter.js';

// ── isIgnoredDirName ──────────────────────────────────────────────────────────

test('isIgnoredDirName: node_modules is ignored', () => {
  assert.ok(isIgnoredDirName('node_modules'));
});

test('isIgnoredDirName: dist is ignored', () => {
  assert.ok(isIgnoredDirName('dist'));
});

test('isIgnoredDirName: .git is ignored (leading dot)', () => {
  assert.ok(isIgnoredDirName('.git'));
});

test('isIgnoredDirName: any dotfile dir is ignored', () => {
  assert.ok(isIgnoredDirName('.hidden'));
  assert.ok(isIgnoredDirName('.cache'));
  assert.ok(isIgnoredDirName('.env'));
});

test('isIgnoredDirName: src is not ignored', () => {
  assert.ok(!isIgnoredDirName('src'));
});

test('isIgnoredDirName: lib is not ignored', () => {
  assert.ok(!isIgnoredDirName('lib'));
});

test('isIgnoredDirName: __pycache__ is ignored', () => {
  assert.ok(isIgnoredDirName('__pycache__'));
});

// ── isGeneratedArtifact ───────────────────────────────────────────────────────

test('isGeneratedArtifact: .min.js is generated', () => {
  assert.ok(isGeneratedArtifact('dist/app.min.js'));
});

test('isGeneratedArtifact: .bundle.js is generated', () => {
  assert.ok(isGeneratedArtifact('app.bundle.js'));
});

test('isGeneratedArtifact: .d.ts declaration file is generated', () => {
  assert.ok(isGeneratedArtifact('src/types.d.ts'));
});

test('isGeneratedArtifact: .map file is generated', () => {
  assert.ok(isGeneratedArtifact('dist/app.js.map'));
});

test('isGeneratedArtifact: file in vendor/ directory is generated', () => {
  assert.ok(isGeneratedArtifact('vendor/lodash/lodash.js'));
});

test('isGeneratedArtifact: file in __generated__/ directory is generated', () => {
  assert.ok(isGeneratedArtifact('src/__generated__/graphql.ts'));
});

test('isGeneratedArtifact: .pb.ts protobuf file is generated', () => {
  assert.ok(isGeneratedArtifact('src/proto/types.pb.ts'));
});

test('isGeneratedArtifact: regular source file is not generated', () => {
  assert.ok(!isGeneratedArtifact('src/auth/middleware.ts'));
});

test('isGeneratedArtifact: test file is not generated', () => {
  assert.ok(!isGeneratedArtifact('src/auth/middleware.test.ts'));
});

// ── SOURCE_EXTS ───────────────────────────────────────────────────────────────

test('SOURCE_EXTS includes TypeScript and Python extensions', () => {
  assert.ok(SOURCE_EXTS.includes('.ts'));
  assert.ok(SOURCE_EXTS.includes('.tsx'));
  assert.ok(SOURCE_EXTS.includes('.py'));
  assert.ok(SOURCE_EXTS.includes('.go'));
});

// ── IGNORE_DIRS ───────────────────────────────────────────────────────────────

test('IGNORE_DIRS is a Set containing coverage and vendor', () => {
  assert.ok(IGNORE_DIRS instanceof Set);
  assert.ok(IGNORE_DIRS.has('coverage'));
  assert.ok(IGNORE_DIRS.has('vendor'));
});
