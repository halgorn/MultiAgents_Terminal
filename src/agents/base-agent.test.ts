import test from 'node:test';
import assert from 'node:assert/strict';
import { BaseAgent } from './base-agent.js';
import type { TaskState } from '../core/state-machine.js';

// Minimal concrete subclass to expose protected parseJson for testing
class TestAgent extends BaseAgent<string, unknown> {
  protected buildUserMessage(input: string): string { return input; }
  protected parseOutput(text: string): unknown { return this.callParseJson(text); }
  protected resolveState(): TaskState { return 'DONE'; }
  protected getWorktreePath(): string { return '/tmp'; }

  callParseJson(text: string): unknown {
    return this.parseJson(text, 'TestAgent');
  }
}

const agent = new TestAgent({ name: 'test', provider: 'claude', systemPrompt: '' });

function parse(text: string): unknown {
  return agent.callParseJson(text);
}

// ── parseJson: basic extraction ───────────────────────────────────────────────

test('parseJson: extracts plain JSON object', () => {
  const result = parse('{"foo":"bar","count":42}');
  assert.deepEqual(result, { foo: 'bar', count: 42 });
});

test('parseJson: extracts JSON from surrounding prose', () => {
  const result = parse('Here is the result:\n{"status":"ok"}\nEnd of output.');
  assert.deepEqual(result, { status: 'ok' });
});

test('parseJson: strips markdown json fence', () => {
  const result = parse('```json\n{"key":"value"}\n```');
  assert.deepEqual(result, { key: 'value' });
});

test('parseJson: strips plain triple-backtick fence', () => {
  const result = parse('```\n{"x":1}\n```');
  assert.deepEqual(result, { x: 1 });
});

// ── parseJson: string-aware brace handling ────────────────────────────────────

test('parseJson: braces inside string values do not confuse depth tracking', () => {
  const result = parse('{"template":"SELECT * FROM {table}","count":5}');
  assert.deepEqual(result, { template: 'SELECT * FROM {table}', count: 5 });
});

test('parseJson: escaped quotes inside strings are handled', () => {
  const result = parse('{"message":"say \\"hello\\""}');
  assert.deepEqual(result, { message: 'say "hello"' });
});

test('parseJson: nested objects parsed correctly', () => {
  const result = parse('{"outer":{"inner":{"deep":true}}}');
  assert.deepEqual(result, { outer: { inner: { deep: true } } });
});

// ── parseJson: error detection ────────────────────────────────────────────────

test('parseJson: throws on completely non-JSON text', () => {
  assert.throws(() => parse('No JSON here at all, just plain text.'), /failed to parse JSON/);
});

test('parseJson: throws with authentication hint when CLI login message detected', () => {
  assert.throws(
    () => parse('Please run /login to authenticate'),
    /not authenticated|login/i,
  );
});

test('parseJson: throws when JSON is malformed (unclosed brace)', () => {
  assert.throws(() => parse('{"key": "value"'), /failed to parse JSON/);
});

// ── parseJson: first-object extraction ───────────────────────────────────────

test('parseJson: extracts first object when multiple JSON objects present', () => {
  const result = parse('{"first":1}{"second":2}');
  assert.deepEqual(result, { first: 1 });
});

test('parseJson: handles JSON array values inside object', () => {
  const result = parse('{"items":[1,2,3],"label":"test"}');
  assert.deepEqual(result, { items: [1, 2, 3], label: 'test' });
});
