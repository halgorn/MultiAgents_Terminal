import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_ITEMS, runMenuFallback } from './menu.js';

test('menu principal tem os 8 itens acionáveis esperados', () => {
  const selectable = MAIN_ITEMS
    .filter((item) => !item.header && !item.separator && item.value !== '' && item.value !== 'sep' && item.value !== 'quit')
    .map((item) => item.value);

  assert.deepEqual(selectable, ['bugs', 'security', 'perf', 'fix', 'analyze', 'chat', 'health', 'setup']);
});

test('menu não tem submenus antigos', () => {
  const labels = MAIN_ITEMS.map((item) => item.label);

  assert.equal(labels.includes('Diagnóstico local'), false);
  assert.equal(labels.includes('IA — Copilot / Audit'), false);
  assert.equal(labels.includes('Avançado'), false);
  assert.equal(labels.includes('Publicar / operar'), false);
});

test('menu tem os labels corretos', () => {
  const labels = MAIN_ITEMS.map((item) => item.label);

  assert.equal(labels.includes('🐛 Bugs & Qualidade'), true);
  assert.equal(labels.includes('🔐 Segurança'), true);
  assert.equal(labels.includes('⚡ Performance & Infra'), true);
  assert.equal(labels.includes('🔧 Corrigir arquivo'), true);
  assert.equal(labels.includes('🔍 Analisar problema'), true);
  assert.equal(labels.includes('💬 Chat sobre o repo'), true);
  assert.equal(labels.includes('📊 Health check'), true);
  assert.equal(labels.includes('⚙️  Setup'), true);
});

test('non-TTY fallback imprime comandos acionáveis', () => {
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
  assert.match(output, /aion fix/);
  assert.match(output, /aion setup/);
  assert.match(output, /aion audit/);
});
