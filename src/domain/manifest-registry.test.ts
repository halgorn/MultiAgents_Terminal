import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManifestRegistry, validateAll } from './manifest-registry.js';

interface Item {
  name: string;
  kind: string;
}

test('ManifestRegistry: register and get', () => {
  const reg = new ManifestRegistry<Item>();
  reg.register({ name: 'a', kind: 'first' });
  reg.register({ name: 'b', kind: 'second' });
  assert.equal(reg.get('a')?.kind, 'first');
  assert.equal(reg.get('b')?.kind, 'second');
  assert.equal(reg.get('missing'), undefined);
});

test('ManifestRegistry: alias resolves to target', () => {
  const reg = new ManifestRegistry<Item>();
  reg.register({ name: 'a', kind: 'first' });
  reg.alias('alpha', 'a');
  assert.equal(reg.get('alpha')?.kind, 'first');
});

test('ManifestRegistry: rejects duplicate name', () => {
  const reg = new ManifestRegistry<Item>();
  reg.register({ name: 'a', kind: 'first' });
  assert.throws(() => reg.register({ name: 'a', kind: 'dup' }));
});

test('ManifestRegistry: rejects alias to missing target', () => {
  const reg = new ManifestRegistry<Item>();
  assert.throws(() => reg.alias('foo', 'missing'));
});

test('ManifestRegistry: all returns readonly array', () => {
  const reg = new ManifestRegistry<Item>();
  reg.register({ name: 'a', kind: 'x' });
  reg.register({ name: 'b', kind: 'y' });
  const items = reg.all();
  assert.equal(items.length, 2);
  assert.equal(items[0].name, 'a');
  assert.equal(items[1].name, 'b');
});

test('ManifestRegistry: validate passes on clean registry', () => {
  const reg = new ManifestRegistry<Item>();
  reg.register({ name: 'a', kind: 'x' });
  reg.alias('alpha', 'a');
  const v = reg.validate();
  assert.equal(v.ok, true);
});

test('ManifestRegistry: validate detects dangling alias', () => {
  const reg = new ManifestRegistry<Item>();
  reg.register({ name: 'a', kind: 'x' });
  // Manually inject dangling alias to bypass register-time check
  (reg as unknown as { aliases: Map<string, string> }).aliases.set('bad', 'missing');
  const v = reg.validate();
  assert.equal(v.ok, false);
});

test('ManifestRegistry: has checks name or alias', () => {
  const reg = new ManifestRegistry<Item>();
  reg.register({ name: 'a', kind: 'x' });
  reg.alias('alpha', 'a');
  assert.ok(reg.has('a'));
  assert.ok(reg.has('alpha'));
  assert.ok(!reg.has('missing'));
});

test('ManifestRegistry: size and names', () => {
  const reg = new ManifestRegistry<Item>();
  reg.register({ name: 'a', kind: 'x' });
  reg.register({ name: 'b', kind: 'y' });
  assert.equal(reg.size(), 2);
  assert.deepEqual(reg.names(), ['a', 'b']);
});

test('ManifestRegistry: clear empties everything', () => {
  const reg = new ManifestRegistry<Item>();
  reg.register({ name: 'a', kind: 'x' });
  reg.alias('alpha', 'a');
  reg.clear();
  assert.equal(reg.size(), 0);
  assert.equal(reg.get('alpha'), undefined);
});

test('validateAll: aggregates issues from multiple registries', () => {
  const a = new ManifestRegistry<Item>();
  const b = new ManifestRegistry<Item>();
  a.register({ name: 'x', kind: 'ok' });
  (b as unknown as { items: Map<string, Item> }).items.set('y', { name: 'y', kind: 'ok' });
  (b as unknown as { items: Map<string, Item> }).items.set('y', { name: 'y', kind: 'dup' });
  const result = validateAll({ a, b });
  assert.equal(result.ok, false);
});