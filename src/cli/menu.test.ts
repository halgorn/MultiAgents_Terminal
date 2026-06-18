import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_ITEMS, runMenuFallback } from './menu.js';

test('main menu has the expected actionable items', () => {
  const selectable = MAIN_ITEMS
    .filter((item) => !item.header && !item.separator && item.value !== '' && item.value !== 'sep' && item.value !== 'quit')
    .map((item) => item.value);

  assert.deepEqual(selectable, ['local-check', 'seo', 'network-scan', 'app-security', 'bugs', 'security', 'perf', 'copilot', 'fix', 'analyze', 'assistant', 'chat-qa', 'report', 'links', 'doctor', 'providers', 'change-provider']);
});

test('menu does not include old submenus', () => {
  const labels = MAIN_ITEMS.map((item) => item.label);

  assert.equal(labels.includes('Local diagnostics'), false);
  assert.equal(labels.includes('IA — Copilot / Audit'), false);
  assert.equal(labels.includes('Advanced'), false);
  assert.equal(labels.includes('Publish / operate'), false);
});

test('menu has the correct English labels', () => {
  const labels = MAIN_ITEMS.map((item) => item.label);

  assert.equal(labels.includes('📊 Automatic diagnostics'), true);
  assert.equal(labels.includes('🌐 SEO & Crawlers'), true);
  assert.equal(labels.includes('🐛 Bugs & Quality'), true);
  assert.equal(labels.includes('🔐 Security'), true);
  assert.equal(labels.includes('⚡ Performance & Infra'), true);
  assert.equal(labels.includes('🔧 Fix file'), true);
  assert.equal(labels.includes('🔍 Analyze problem'), true);
  assert.equal(labels.includes('🤖 Direct assistant'), true);
  assert.equal(labels.includes('💬 Code chat'), true);
  assert.equal(labels.includes('📋 View report'), true);
  assert.equal(labels.includes('🔗 Project links'), true);
  assert.equal(labels.includes('🧪 DeepEval quickcheck'), false);
  assert.equal(labels.includes('🕸️ AI orchestrator'), false);
  assert.equal(labels.includes('⚙️  Setup'), false);
});

test('non-TTY fallback prints actionable commands', () => {
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
  assert.match(output, /aion scan seo/);
  assert.match(output, /aion fix/);
  assert.match(output, /aion audit/);
  assert.match(output, /https:\/\/github\.com\/halgorn\/MultiAgents_Terminal/);
  assert.match(output, /https:\/\/www\.linkedin\.com\/in\/bruno-inacio-036530170\//);
  assert.match(output, /brunoinacio3000@hotmail\.com/);
  assert.match(output, /zero token/i);
  assert.doesNotMatch(output, /aion setup/);
  assert.doesNotMatch(output, /aion deepeval/);
  assert.doesNotMatch(output, /AION_ORCHESTRATOR=langgraph/);
});
