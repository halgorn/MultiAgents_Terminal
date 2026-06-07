import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_ITEMS, DIRECT_COMMANDS, MENU_ACTION_AUDIT, runMenuFallback } from './menu.js';

test('menu action audit covers every selectable main menu item', () => {
  const selectable = MAIN_ITEMS
    .filter((item) => !item.header && !item.separator && item.value !== '' && item.value !== 'sep' && item.value !== 'quit')
    .map((item) => item.value);
  const audited = new Set(MENU_ACTION_AUDIT.map((entry) => entry.action));

  assert.deepEqual(selectable.filter((action) => !audited.has(action)), []);
});

test('main menu exposes simplified human workflows', () => {
  const labels = MAIN_ITEMS.map((item) => item.label);

  assert.equal(labels.includes('Ver estado do projeto'), true);
  assert.equal(labels.includes('Encontrar problemas'), true);
  assert.equal(labels.includes('Buscar e entender código'), true);
  assert.equal(labels.includes('Corrigir ou revisar com IA'), true);
  assert.equal(labels.includes('Publicar / operar'), true);
  assert.equal(labels.includes('Avançado'), true);
});

test('direct menu commands map to real CLI subcommands without cwd baked in', () => {
  assert.deepEqual(DIRECT_COMMANDS.health, ['health']);
  assert.deepEqual(DIRECT_COMMANDS.tree, ['tree', '--hotspots']);
  assert.deepEqual(DIRECT_COMMANDS.trace, ['trace']);
  assert.equal(Object.hasOwn(DIRECT_COMMANDS, 'impact'), false);
});

test('menu matrix classifies advanced or costly actions explicitly', () => {
  const byAction = new Map(MENU_ACTION_AUDIT.map((entry) => [entry.action, entry]));

  assert.equal(byAction.get('scan')?.cost, 'zero-token');
  assert.equal(byAction.get('audit')?.cost, 'ai');
  assert.equal(byAction.get('mcp')?.recommendation, 'hide');
  assert.equal(byAction.get('impact')?.submenu, 'prompt');
});

test('non-TTY menu fallback prints actionable commands and exits', () => {
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

  assert.match(output, /aion — example-project/);
  assert.match(output, /aion health/);
  assert.match(output, /aion audit \. --preset security/);
  assert.match(output, /aion deploy assist/);
});
