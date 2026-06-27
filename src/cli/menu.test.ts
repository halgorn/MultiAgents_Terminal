import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_ITEMS, runMenuFallback } from './menu.js';

test('main menu has exactly 2 actions + provider + quit', () => {
  const selectable = MAIN_ITEMS
    .filter((item) => !item.header && !item.separator && item.value !== '' && item.value !== 'sep' && item.value !== 'quit')
    .map((item) => item.value);

  const expected = ['audit-doctor', 'connect', 'change-provider'];
  for (const e of expected) {
    assert.ok(selectable.includes(e), `missing action: ${e}; got: ${JSON.stringify(selectable)}`);
  }
  assert.equal(selectable.length, 3, `expected exactly 3 selectable items, got ${selectable.length}`);
});

test('menu does not include find or chat', () => {
  const labels = MAIN_ITEMS.map((item) => item.label);
  assert.equal(labels.some((l) => l.includes('Find') && l.startsWith('2.')), false);
  assert.equal(labels.some((l) => l.includes('Chat')), false);
});

test('audit and doctor are merged into one option', () => {
  const labels = MAIN_ITEMS.map((item) => item.label);
  const merged = labels.find((l) => l.includes('Audit') && l.includes('Doctor'));
  assert.ok(merged, 'should have an Audit+Doctor merged option');
  assert.ok(merged!.includes('1.'), 'should be the first option');
});

test('connect is the second option and mentions provider', () => {
  const labels = MAIN_ITEMS.map((item) => item.label);
  const connect = labels.find((l) => l.startsWith('2.'));
  assert.ok(connect);
  assert.match(connect!, /Connect/);
});

test('non-TTY fallback mentions the 2 main commands', () => {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    runMenuFallback('/tmp/example-project');
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.match(output, /aion doctor/);
  assert.match(output, /aion audit/);
  assert.match(output, /aion mcp install/);
  assert.match(output, /aion --tldr/);
});
