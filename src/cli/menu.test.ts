import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_ITEMS, runMenuFallback } from './menu.js';

test('main menu has the 8 canonical actions', () => {
  const selectable = MAIN_ITEMS
    .filter((item) => !item.header && !item.separator && item.value !== '' && item.value !== 'sep' && item.value !== 'quit')
    .map((item) => item.value);

  const expected = ['doctor', 'sync', 'find', 'audit', 'chat', 'wiki', 'mcp-install', 'next', 'change-provider', 'help'];
  for (const e of expected) {
    assert.ok(selectable.includes(e), `missing action: ${e}; got: ${JSON.stringify(selectable)}`);
  }
});

test('menu does not include old submenus', () => {
  const labels = MAIN_ITEMS.map((item) => item.label);

  assert.equal(labels.some((l) => l.includes('Local diagnostics')), false);
  assert.equal(labels.some((l) => l.includes('SEO')), false);
  assert.equal(labels.some((l) => l.includes('Copilot')), false);
  assert.equal(labels.some((l) => l.includes('Project links')), false);
  assert.equal(labels.some((l) => l.includes('View report')), false);
  assert.equal(labels.some((l) => l.includes('Direct assistant')), false);
  assert.equal(labels.some((l) => l.includes('LangFuse')), false);
});

test('menu has the 8 numbered items', () => {
  const labels = MAIN_ITEMS.map((item) => item.label);
  assert.ok(labels.some((l) => l.startsWith('1.')), 'missing 1.');
  assert.ok(labels.some((l) => l.startsWith('2.')), 'missing 2.');
  assert.ok(labels.some((l) => l.startsWith('3.')), 'missing 3.');
  assert.ok(labels.some((l) => l.startsWith('4.')), 'missing 4.');
  assert.ok(labels.some((l) => l.startsWith('5.')), 'missing 5.');
  assert.ok(labels.some((l) => l.startsWith('6.')), 'missing 6.');
  assert.ok(labels.some((l) => l.startsWith('7.')), 'missing 7.');
  assert.ok(labels.some((l) => l.startsWith('8.')), 'missing 8.');
});

test('non-TTY fallback prints 8 canonical commands', () => {
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

  assert.match(output, /aion init/);
  assert.match(output, /aion sync/);
  assert.match(output, /aion mcp install/);
  assert.match(output, /aion find/);
  assert.match(output, /aion chat/);
  assert.match(output, /aion audit/);
  assert.match(output, /aion wiki/);
  assert.match(output, /aion doctor/);
  assert.match(output, /aion --tldr/);
  assert.doesNotMatch(output, /aion health/);
  assert.doesNotMatch(output, /aion scan seo/);
  assert.doesNotMatch(output, /aion setup/);
});