import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './classifier.js';

// ── intent classification ─────────────────────────────────────────────────────

test('classify: "fix" keyword → intent fix', () => {
  assert.equal(classify('fix the login bug').intent, 'fix');
});

test('classify: "bug" keyword → intent fix', () => {
  assert.equal(classify('there is a bug in auth.ts').intent, 'fix');
});

test('classify: "audit" keyword → intent audit', () => {
  assert.equal(classify('audit all files for security issues').intent, 'audit');
});

test('classify: "scan" keyword → intent audit', () => {
  assert.equal(classify('scan the codebase').intent, 'audit');
});

test('classify: "analyze" keyword → intent analyze', () => {
  assert.equal(classify('analyze the authentication flow').intent, 'analyze');
});

test("classify: \"what's wrong\" → intent analyze", () => {
  assert.equal(classify("what's wrong with the payment flow").intent, 'analyze');
});

test('classify: "review" keyword → intent review', () => {
  assert.equal(classify('review this pull request').intent, 'review');
});

test('classify: "code review" keyword → intent review', () => {
  assert.equal(classify('code review src/auth.ts').intent, 'review');
});

test('classify: "memory build" → intent memory-build', () => {
  assert.equal(classify('memory build the codebase').intent, 'memory-build');
});

test('classify: "memory search" → intent memory-search', () => {
  assert.equal(classify('memory search for authentication patterns').intent, 'memory-search');
});

test('classify: "graph" keyword → intent graph-index', () => {
  assert.equal(classify('graph the repo dependencies').intent, 'graph-index');
});

test('classify: unknown input → intent unknown', () => {
  assert.equal(classify('hello world').intent, 'unknown');
});

test('classify: empty string → intent unknown', () => {
  assert.equal(classify('').intent, 'unknown');
});

// ── Portuguese keyword support ────────────────────────────────────────────────

test('classify: Portuguese "corrija" → intent fix', () => {
  assert.equal(classify('corrija o bug no login').intent, 'fix');
});

test('classify: Portuguese "analise" → intent analyze', () => {
  assert.equal(classify('analise o problema').intent, 'analyze');
});

test('classify: Portuguese "auditoria" → intent audit', () => {
  assert.equal(classify('auditoria completa do código').intent, 'audit');
});

// ── target extraction ─────────────────────────────────────────────────────────

test('classify: strips leading "fix" from target', () => {
  const { target } = classify('fix the broken auth module');
  assert.ok(!target.startsWith('fix '), `expected leading "fix" stripped, got: "${target}"`);
});

test('classify: strips leading "review" from target', () => {
  const { target } = classify('review src/auth.ts');
  assert.ok(!target.startsWith('review '), `expected "review" stripped, got: "${target}"`);
});

test('classify: preserves target when no leading intent word', () => {
  const { target } = classify('there is a crash in the payment module');
  assert.ok(target.length > 0);
});
