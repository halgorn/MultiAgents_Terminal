import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FlatVectorIndex, cosineSimilarity, serializeFlatIndex, deserializeFlatIndex } from './index.js';

test('FlatVectorIndex: starts empty', () => {
  const idx = new FlatVectorIndex(8);
  assert.equal(idx.size(), 0);
  assert.deepEqual(idx.search(new Float32Array(8).fill(1), 5), []);
});

test('FlatVectorIndex: insert and search by similarity', () => {
  const idx = new FlatVectorIndex(4);
  const a = new Float32Array([1, 0, 0, 0]);
  const b = new Float32Array([0, 1, 0, 0]);
  const c = new Float32Array([0.9, 0.1, 0, 0]);
  idx.insert('a', a);
  idx.insert('b', b);
  idx.insert('c', c);
  const results = idx.search(a, 2);
  assert.equal(results[0]!.id, 'a');
  assert.equal(results[1]!.id, 'c');
});

test('FlatVectorIndex: dim mismatch throws', () => {
  const idx = new FlatVectorIndex(4);
  assert.throws(() => idx.insert('x', new Float32Array(8)));
});

test('FlatVectorIndex: query dim mismatch throws', () => {
  const idx = new FlatVectorIndex(4);
  idx.insert('x', new Float32Array(4));
  assert.throws(() => idx.search(new Float32Array(8), 1));
});

test('FlatVectorIndex: persist and load roundtrip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-vec-'));
  try {
    const path = join(dir, 'idx.bin');
    const idx = new FlatVectorIndex(4);
    idx.insert('a', new Float32Array([1, 2, 3, 4]));
    idx.insert('b', new Float32Array([5, 6, 7, 8]));
    await idx.persist(path);
    assert.ok(existsSync(path));
    const idx2 = new FlatVectorIndex(4);
    await idx2.load(path);
    assert.equal(idx2.size(), 2);
    const results = idx2.search(new Float32Array([1, 2, 3, 4]), 1);
    assert.equal(results[0]!.id, 'a');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FlatVectorIndex: load non-existent file is no-op', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-vec-'));
  try {
    const idx = new FlatVectorIndex(4);
    await idx.load(join(dir, 'missing.bin'));
    assert.equal(idx.size(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FlatVectorIndex: load dim mismatch throws', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-vec-'));
  try {
    const path = join(dir, 'idx.bin');
    const idx1 = new FlatVectorIndex(4);
    idx1.insert('a', new Float32Array(4));
    await idx1.persist(path);
    const idx2 = new FlatVectorIndex(8);
    await assert.rejects(() => idx2.load(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cosineSimilarity: identical vectors return 1', () => {
  const v = new Float32Array([1, 2, 3]);
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-6);
});

test('cosineSimilarity: orthogonal vectors return 0', () => {
  const a = new Float32Array([1, 0]);
  const b = new Float32Array([0, 1]);
  assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-6);
});

test('cosineSimilarity: opposite vectors return -1', () => {
  const a = new Float32Array([1, 0]);
  const b = new Float32Array([-1, 0]);
  assert.ok(Math.abs(cosineSimilarity(a, b) + 1) < 1e-6);
});

test('serializeFlatIndex: roundtrip preserves data', () => {
  const ids = ['hello', 'world', 'test'];
  const dim = 4;
  const vectors = ids.map((_, i) => new Float32Array([i, i + 1, i + 2, i + 3]));
  const buf = serializeFlatIndex(ids, vectors, dim);
  const restored = deserializeFlatIndex(buf);
  assert.equal(restored.dim, dim);
  assert.equal(restored.ids.length, ids.length);
  assert.deepEqual(restored.ids, ids);
  for (let i = 0; i < ids.length; i++) {
    assert.deepEqual(Array.from(restored.vectors[i]!), Array.from(vectors[i]!));
  }
});

test('serializeFlatIndex: bad magic throws', () => {
  const buf = Buffer.alloc(64);
  buf.writeUInt32LE(4, 0);
  buf.writeUInt32LE(0, 4);
  assert.throws(() => deserializeFlatIndex(buf), /bad magic/);
});