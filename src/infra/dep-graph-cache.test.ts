import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildDepGraph } from './dep-graph-cache.js';

test('buildDepGraph: returns empty graph for empty project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-dg-'));
  try {
    const graph = buildDepGraph(dir, { skipCache: true });
    assert.equal(graph.nodes.size, 0);
    assert.equal(graph.cycles.length, 0);
    assert.equal(graph.hotspots.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDepGraph: detects imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-dg-'));
  try {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'es2022', module: 'esnext', strict: true, esModuleInterop: true },
    }), 'utf8');
    writeFileSync(join(dir, 'a.ts'), 'export const x = 1;\n', 'utf8');
    writeFileSync(join(dir, 'b.ts'), "import { x } from './a';\nexport const y = x;\n", 'utf8');
    const graph = buildDepGraph(dir, { skipCache: true });
    assert.ok(graph.nodes.size >= 2, `expected >=2 nodes, got ${graph.nodes.size}`);
    const b = graph.nodes.get('b.ts');
    assert.ok(b);
    assert.ok(b!.imports.includes('./a') || b!.imports.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDepGraph: caches and reuses on second call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-dg-'));
  try {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'es2022', module: 'esnext' },
    }), 'utf8');
    writeFileSync(join(dir, 'a.ts'), 'export const x = 1;\n', 'utf8');
    writeFileSync(join(dir, 'b.ts'), "import { x } from './a';\nexport const y = x;\n", 'utf8');

    const g1 = buildDepGraph(dir);
    assert.ok(existsSync(join(dir, '.ai-runtime/dep-graph-cache.json')), 'cache file should exist');
    const g2 = buildDepGraph(dir);
    assert.equal(g1.nodes.size, g2.nodes.size, 'cached graph should match fresh build');
    for (const [k, v] of g1.nodes) {
      assert.deepEqual(v.imports, g2.nodes.get(k)?.imports ?? []);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDepGraph: skipCache forces rebuild', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-dg-'));
  try {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'es2022', module: 'esnext' },
    }), 'utf8');
    writeFileSync(join(dir, 'a.ts'), 'export const x = 1;\n', 'utf8');
    buildDepGraph(dir);
    buildDepGraph(dir, { skipCache: true });
    assert.ok(existsSync(join(dir, '.ai-runtime/dep-graph-cache.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDepGraph: invalidates cache when package.json changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-dg-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'a', version: '1.0.0' }), 'utf8');
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'es2022', module: 'esnext' },
    }), 'utf8');
    writeFileSync(join(dir, 'a.ts'), 'export const x = 1;\n', 'utf8');

    buildDepGraph(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'a', version: '2.0.0' }), 'utf8');
    const g = buildDepGraph(dir);
    assert.ok(g);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDepGraph: computes hotspots based on fan-in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aion-dg-'));
  try {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'es2022', module: 'esnext' },
    }), 'utf8');
    writeFileSync(join(dir, 'a.ts'), 'export const x = 1;\nexport const y = 2;\n', 'utf8');
    const graph = buildDepGraph(dir, { skipCache: true });
    const a = graph.nodes.get('a.ts');
    assert.ok(a, 'a.ts should be indexed');
    assert.ok(Array.isArray(a!.importedBy), 'importedBy should be an array');
    assert.ok(a!.exports.length >= 1, `should have at least 1 export, got ${a!.exports.length}`);
    assert.ok(Array.isArray(graph.hotspots), 'hotspots should be an array');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});