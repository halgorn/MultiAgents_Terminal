import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitDeprecation, lookupDeprecation, COMMAND_MIGRATIONS, TLDR_TEXT } from './deprecation.js';

test('emitDeprecation: prints banner once per command', () => {
  const old = console.error;
  let captured = '';
  console.error = (msg: string) => { captured += msg + '\n'; };
  try {
    emitDeprecation('test-cmd', 'aion newcmd');
    emitDeprecation('test-cmd', 'aion newcmd');
    emitDeprecation('test-cmd', 'aion newcmd');
    assert.match(captured, /Deprecation/);
    assert.match(captured, /test-cmd/);
    assert.match(captured, /aion newcmd/);
    const occurrences = (captured.match(/test-cmd/g) ?? []).length;
    assert.equal(occurrences, 1, 'should only print banner once');
  } finally {
    console.error = old;
  }
});

test('emitDeprecation: includes removedIn and notes', () => {
  const old = console.error;
  let captured = '';
  console.error = (msg: string) => { captured += msg + '\n'; };
  try {
    emitDeprecation('unique-cmd-1', 'aion next', { removedIn: 'v2.0', notes: 'extra info' });
    assert.match(captured, /v2\.0/);
    assert.match(captured, /extra info/);
    assert.match(captured, /MIGRATION-V1/);
  } finally {
    console.error = old;
  }
});

test('COMMAND_MIGRATIONS: covers all major deprecated commands', () => {
  const expected = ['setup', 'index', 'memory build', 'memory search', 'search', 'ci', 'assist', 'cloud', 'deploy'];
  for (const cmd of expected) {
    assert.ok(COMMAND_MIGRATIONS[cmd], `missing migration for ${cmd}`);
  }
});

test('lookupDeprecation: returns replacement info', () => {
  const m = lookupDeprecation('memory build');
  assert.equal(m?.replacement, 'aion sync');
});

test('lookupDeprecation: returns undefined for unknown', () => {
  assert.equal(lookupDeprecation('never-deprecated'), undefined);
});

test('TLDR_TEXT: contains the 8 commands', () => {
  for (const cmd of ['init', 'sync', 'mcp', 'wiki', 'find', 'chat', 'doctor', 'next']) {
    assert.match(TLDR_TEXT, new RegExp(cmd));
  }
});

test('TLDR_TEXT: gateway positioning', () => {
  assert.match(TLDR_TEXT, /project gateway/i);
});