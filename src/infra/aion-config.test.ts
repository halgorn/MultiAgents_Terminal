import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig, generateDefaultConfig } from './aion-config.js';
import type { AionConfig } from './aion-config.js';

test('mergeConfig: CLI value takes precedence over config file value', () => {
  const cli = { budget: 'deep', preset: 'security' };
  const config: AionConfig = { budget: 'low', preset: 'bugs' };
  const result = mergeConfig(cli, config);
  assert.equal(result['budget'], 'deep');
  assert.equal(result['preset'], 'security');
});

test('mergeConfig: config file fills in missing CLI values', () => {
  const cli = { budget: undefined, preset: undefined };
  const config: AionConfig = { budget: 'normal', preset: 'security' };
  const result = mergeConfig(cli, config);
  assert.equal(result['budget'], 'normal');
  assert.equal(result['preset'], 'security');
});

test('mergeConfig: domains array is joined to comma-separated string', () => {
  const cli = { domains: undefined };
  const config: AionConfig = { domains: ['security', 'bugs', 'performance'] };
  const result = mergeConfig(cli, config);
  assert.equal(result['domains'], 'security,bugs,performance');
});

test('mergeConfig: null CLI value is treated as unset (config wins)', () => {
  const cli = { budget: null as unknown as string };
  const config: AionConfig = { budget: 'deep' };
  const result = mergeConfig(cli, config);
  assert.equal(result['budget'], 'deep');
});

test('mergeConfig: defaults are applied when CLI and config are unset', () => {
  const cli = { budget: undefined };
  const config: AionConfig = {};
  const result = mergeConfig(cli, config, { budget: 'low' });
  assert.equal(result['budget'], 'low');
});

test('generateDefaultConfig returns expected shape', () => {
  const config = generateDefaultConfig();
  assert.equal(config.budget, 'low');
  assert.equal(config.scanners, 1);
  assert.equal(config.fixMinSeverity, 'high');
  assert.equal(config.provider, 'claude');
});
