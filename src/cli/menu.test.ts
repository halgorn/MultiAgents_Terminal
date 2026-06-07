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

  assert.equal(labels.includes('Diagnóstico local'), true);
  assert.equal(labels.includes('IA — Copilot / Audit'), true);
  assert.equal(labels.includes('Preparar / configurar'), true);
  assert.equal(labels.includes('Publicar / operar'), true);
  assert.equal(labels.includes('Avançado'), true);
  // Modelo 2 e 3 colapsados em IA; NL movido para dentro do menu IA
  assert.equal(labels.includes('Modelo 2 — Copiloto IA'), false);
  assert.equal(labels.includes('Modelo 3 — IA + RAG obrigatório'), false);
  assert.equal(MAIN_ITEMS.filter((i) => !i.separator && i.value !== 'sep' && i.value !== 'quit' && i.value !== '').length, 5);
});

test('direct menu commands map to real CLI subcommands without cwd baked in', () => {
  assert.deepEqual(DIRECT_COMMANDS.setup, ['setup']);
  assert.deepEqual(DIRECT_COMMANDS.health, ['health']);
  assert.deepEqual(DIRECT_COMMANDS.tree, ['tree', '--hotspots']);
  assert.deepEqual(DIRECT_COMMANDS.trace, ['trace']);
  // copilot removido — chamado diretamente em runIaMenu com args explícitos
  assert.equal(Object.hasOwn(DIRECT_COMMANDS, 'copilot'), false);
  assert.equal(Object.hasOwn(DIRECT_COMMANDS, 'impact'), false);
});

test('menu matrix reflete os 5 itens reais do menu principal', () => {
  const byAction = new Map(MENU_ACTION_AUDIT.map((entry) => [entry.action, entry]));

  assert.equal(byAction.get('model-local')?.cost, 'zero-token');
  assert.equal(byAction.get('ia')?.cost, 'ai');
  assert.equal(byAction.get('setup')?.cost, 'local-side-effect');
  assert.equal(byAction.get('publish')?.cost, 'local-side-effect');
  assert.equal(byAction.get('advanced')?.cost, 'external-service');
  assert.equal(MENU_ACTION_AUDIT.length, 5);
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
  assert.match(output, /aion copilot safe/);
  assert.match(output, /aion memory build/);
  assert.match(output, /aion setup/);
  assert.match(output, /aion deploy assist/);
  assert.match(output, /Diagnóstico/);
});
