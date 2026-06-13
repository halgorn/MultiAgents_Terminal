import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveDepGraph, loadDepGraph, isDepGraphCached, computeImpact, formatImpactReport } from './dep-graph-db.js';
import type { DepGraph } from './dep-graph.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'dep-graph-db-'));
}

function makeGraph(entries: Array<{ file: string; imports?: string[] }>): DepGraph {
  const nodes = new Map(entries.map(({ file, imports = [] }) => [
    file,
    { file, imports, importedBy: [], exports: [], loc: 10 },
  ]));
  for (const { file, imports = [] } of entries) {
    for (const imp of imports) {
      const node = nodes.get(imp);
      if (node) node.importedBy.push(file);
    }
  }
  return { nodes, cycles: [], hotspots: [] };
}

// ── saveDepGraph / loadDepGraph ───────────────────────────────────────────────

test('loadDepGraph: returns null for empty dir', () => {
  const dir = makeDir();
  try {
    assert.equal(loadDepGraph(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveDepGraph + loadDepGraph: round-trips nodes and edges', () => {
  const dir = makeDir();
  try {
    const graph = makeGraph([
      { file: 'src/a.ts', imports: ['src/b.ts'] },
      { file: 'src/b.ts' },
    ]);
    saveDepGraph(dir, graph);
    const loaded = loadDepGraph(dir);
    assert.ok(loaded !== null);
    assert.equal(loaded.nodes.length, 2);
    const edgeExists = loaded.edges.some(([from, to]) => from === 'src/a.ts' && to === 'src/b.ts');
    assert.ok(edgeExists, 'edge src/a.ts→src/b.ts should be persisted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isDepGraphCached: false before save, true after', () => {
  const dir = makeDir();
  try {
    assert.equal(isDepGraphCached(dir), false);
    saveDepGraph(dir, makeGraph([{ file: 'src/a.ts' }]));
    assert.equal(isDepGraphCached(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isDepGraphCached: false for a stale cache (builtAt in the past)', () => {
  const dir = makeDir();
  try {
    const cacheDir = join(dir, '.ai-runtime');
    mkdirSync(cacheDir, { recursive: true });
    const staleEntry = {
      nodes: [],
      edges: [],
      builtAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago — past 1-hour TTL
    };
    writeFileSync(join(cacheDir, 'dep-graph.json'), JSON.stringify(staleEntry), 'utf8');
    assert.equal(isDepGraphCached(dir), false, 'stale cache should not count as cached');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── computeImpact ─────────────────────────────────────────────────────────────

test('computeImpact: no importers → empty result', () => {
  const dir = makeDir();
  try {
    saveDepGraph(dir, makeGraph([{ file: 'src/a.ts' }]));
    const stored = loadDepGraph(dir)!;
    const result = computeImpact(stored, 'src/a.ts');
    assert.deepEqual(result.directImporters, []);
    assert.deepEqual(result.transitiveFiles, []);
    assert.equal(result.totalImpact, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeImpact: direct importers identified correctly', () => {
  const dir = makeDir();
  try {
    const graph = makeGraph([
      { file: 'src/x.ts', imports: ['src/lib.ts'] },
      { file: 'src/y.ts', imports: ['src/lib.ts'] },
      { file: 'src/lib.ts' },
    ]);
    saveDepGraph(dir, graph);
    const stored = loadDepGraph(dir)!;
    const result = computeImpact(stored, 'src/lib.ts');
    assert.deepEqual(result.directImporters.sort(), ['src/x.ts', 'src/y.ts']);
    assert.equal(result.totalImpact, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeImpact: transitive importers are BFS-expanded', () => {
  const dir = makeDir();
  try {
    // chain: app.ts → service.ts → repo.ts → db.ts
    const graph = makeGraph([
      { file: 'src/db.ts' },
      { file: 'src/repo.ts', imports: ['src/db.ts'] },
      { file: 'src/service.ts', imports: ['src/repo.ts'] },
      { file: 'src/app.ts', imports: ['src/service.ts'] },
    ]);
    saveDepGraph(dir, graph);
    const stored = loadDepGraph(dir)!;
    const result = computeImpact(stored, 'src/db.ts');
    assert.ok(result.directImporters.includes('src/repo.ts'));
    assert.ok(result.transitiveFiles.includes('src/service.ts'));
    assert.ok(result.transitiveFiles.includes('src/app.ts'));
    assert.equal(result.totalImpact, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeImpact: hotspotOverlap identifies affected hotspot files', () => {
  const dir = makeDir();
  try {
    const graph = makeGraph([
      { file: 'src/lib.ts' },
      { file: 'src/core.ts', imports: ['src/lib.ts'] },
      { file: 'src/hot.ts', imports: ['src/core.ts'] },
    ]);
    saveDepGraph(dir, graph);
    const stored = loadDepGraph(dir)!;
    const result = computeImpact(stored, 'src/lib.ts', ['src/hot.ts', 'src/unrelated.ts']);
    assert.ok(result.hotspotOverlap.includes('src/hot.ts'), 'src/hot.ts is both impacted and a hotspot');
    assert.ok(!result.hotspotOverlap.includes('src/unrelated.ts'), 'src/unrelated.ts not affected');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeImpact: cycle in graph does not cause infinite loop', () => {
  const dir = makeDir();
  try {
    // a → b → c → a (cycle)
    const graph = makeGraph([
      { file: 'src/a.ts', imports: ['src/b.ts'] },
      { file: 'src/b.ts', imports: ['src/c.ts'] },
      { file: 'src/c.ts', imports: ['src/a.ts'] },
    ]);
    saveDepGraph(dir, graph);
    const stored = loadDepGraph(dir)!;
    // Should complete without hanging
    const result = computeImpact(stored, 'src/a.ts');
    assert.ok(result.totalImpact <= 3, 'should not inflate impact beyond node count');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── formatImpactReport ────────────────────────────────────────────────────────

test('formatImpactReport: no importers prints leaf-node message', () => {
  const result = {
    changedFile: 'src/util.ts',
    directImporters: [],
    transitiveFiles: [],
    totalImpact: 0,
    hotspotOverlap: [],
  };
  const report = formatImpactReport(result);
  assert.ok(report.includes('No files import'), report);
});

test('formatImpactReport: risk level LOW for small impact', () => {
  const result = {
    changedFile: 'src/util.ts',
    directImporters: ['src/a.ts'],
    transitiveFiles: [],
    totalImpact: 1,
    hotspotOverlap: [],
  };
  const report = formatImpactReport(result);
  assert.ok(report.includes('LOW'), report);
});

test('formatImpactReport: risk level HIGH for large impact', () => {
  const many = Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`);
  const result = {
    changedFile: 'src/core.ts',
    directImporters: many.slice(0, 5),
    transitiveFiles: many.slice(5),
    totalImpact: 25,
    hotspotOverlap: [],
  };
  const report = formatImpactReport(result);
  assert.ok(report.includes('HIGH'), report);
});

test('formatImpactReport: hotspot overlap section present when non-empty', () => {
  const result = {
    changedFile: 'src/db.ts',
    directImporters: ['src/repo.ts'],
    transitiveFiles: ['src/hot.ts'],
    totalImpact: 2,
    hotspotOverlap: ['src/hot.ts'],
  };
  const report = formatImpactReport(result);
  assert.ok(report.includes('hotspot') || report.includes('Hotspot'), report);
  assert.ok(report.includes('src/hot.ts'), report);
});
