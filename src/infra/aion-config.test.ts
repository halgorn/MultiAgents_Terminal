import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig, detectAvailableProvider, detectMcpClients } from './aion-config.js';

test('mergeConfig: CLI value takes precedence over config file value', () => {
  const cli = { budget: 'deep', preset: 'security' };
  const config = { budget: 'low', preset: 'bugs' };
  const result = mergeConfig<typeof cli>(cli, config);
  assert.equal(result['budget'], 'deep');
  assert.equal(result['preset'], 'security');
});

test('mergeConfig: config file fills in missing CLI values', () => {
  const cli: Record<string, string | undefined> = { budget: undefined, preset: undefined };
  const config = { budget: 'normal', preset: 'security' };
  const result = mergeConfig(cli, config);
  assert.equal(result['budget'], 'normal');
  assert.equal(result['preset'], 'security');
});

test('mergeConfig: empty configs merge to empty', () => {
  const cli = {};
  const config = {};
  const result = mergeConfig(cli, config);
  assert.deepEqual(result, {});
});

test('detectAvailableProvider: returns null when no keys', () => {
  const old = { ...process.env };
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['OPENAI_API_KEY'];
  delete process.env['OPENROUTER_API_KEY'];
  delete process.env['MOONSHOT_API_KEY']; delete process.env['OPENAI_API_KEY'];
  delete process.env['MINIMAX_API_KEY'];
  try {
    assert.equal(detectAvailableProvider(), null);
  } finally {
    process.env = old;
  }
});

test('detectAvailableProvider: detects ANTHROPIC_API_KEY as claude', () => {
  const old = process.env['ANTHROPIC_API_KEY'];
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
  try {
    const detected = detectAvailableProvider();
    assert.equal(detected?.provider, 'claude');
    assert.equal(detected?.envVar, 'ANTHROPIC_API_KEY');
  } finally {
    if (old) process.env['ANTHROPIC_API_KEY'] = old;
    else delete process.env['ANTHROPIC_API_KEY'];
  }
});

test('detectAvailableProvider: priority order — ANTHROPIC > OPENAI > OPENROUTER > MOONSHOT > MINIMAX', () => {
  const old = { ...process.env };
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['OPENAI_API_KEY'];
  delete process.env['OPENROUTER_API_KEY'];
  process.env['MINIMAX_API_KEY'] = 'k';
  try {
    assert.equal(detectAvailableProvider()?.provider, 'minimax');
    process.env['MOONSHOT_API_KEY'] = 'k';
    assert.equal(detectAvailableProvider()?.provider, 'kimi');
    process.env['OPENAI_API_KEY'] = 'k';
    assert.equal(detectAvailableProvider()?.provider, 'codex');
    delete process.env['MOONSHOT_API_KEY']; delete process.env['OPENAI_API_KEY'];
    delete process.env['MINIMAX_API_KEY'];
    process.env['OPENROUTER_API_KEY'] = 'k';
    assert.equal(detectAvailableProvider()?.provider, 'openrouter');
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'k';
    assert.equal(detectAvailableProvider()?.provider, 'claude');
  } finally {
    process.env = old;
  }
});

test('detectMcpClients: returns array (may be empty)', () => {
  const result = detectMcpClients('/tmp');
  assert.ok(Array.isArray(result));
});
