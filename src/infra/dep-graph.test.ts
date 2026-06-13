import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPythonDepGraph, formatDepReport } from './dep-graph.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'dep-graph-'));
}

function writePy(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content);
}

// ── buildPythonDepGraph ───────────────────────────────────────────────────────

test('buildPythonDepGraph: empty dir has no nodes and no cycles', () => {
  const dir = makeDir();
  try {
    const graph = buildPythonDepGraph(dir);
    assert.equal(graph.nodes.size, 0);
    assert.deepEqual(graph.cycles, []);
    assert.deepEqual(graph.hotspots, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPythonDepGraph: single file with no imports creates one node', () => {
  const dir = makeDir();
  try {
    writePy(dir, 'main.py', 'def hello(): pass\n');
    const graph = buildPythonDepGraph(dir);
    assert.equal(graph.nodes.size, 1);
    assert.ok(graph.nodes.has('main.py'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPythonDepGraph: import creates edges between nodes', () => {
  const dir = makeDir();
  try {
    writePy(dir, 'utils.py', 'def helper(): pass\n');
    writePy(dir, 'app.py', 'from utils import helper\n');
    const graph = buildPythonDepGraph(dir);
    const app = graph.nodes.get('app.py');
    assert.ok(app, 'app.py should be in graph');
    assert.ok(app!.imports.includes('utils.py'), `expected utils.py in imports, got: ${app!.imports.join(', ')}`);
    const utils = graph.nodes.get('utils.py');
    assert.ok(utils!.importedBy.includes('app.py'), `expected app.py in importedBy, got: ${utils!.importedBy.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPythonDepGraph: circular imports are detected as cycles', () => {
  const dir = makeDir();
  try {
    writePy(dir, 'a.py', 'from b import b_fn\n');
    writePy(dir, 'b.py', 'from a import a_fn\n');
    const graph = buildPythonDepGraph(dir);
    assert.ok(graph.cycles.length > 0, 'expected cycle between a.py and b.py');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPythonDepGraph: no cycle for linear chain', () => {
  const dir = makeDir();
  try {
    writePy(dir, 'c.py', 'def c(): pass\n');
    writePy(dir, 'b.py', 'from c import c\n');
    writePy(dir, 'a.py', 'from b import b\ndef b(): pass\n');
    const graph = buildPythonDepGraph(dir);
    assert.equal(graph.cycles.length, 0, `unexpected cycles: ${JSON.stringify(graph.cycles)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPythonDepGraph: hotspot detects most-imported file', () => {
  const dir = makeDir();
  try {
    writePy(dir, 'core.py', 'def shared(): pass\n');
    writePy(dir, 'a.py', 'from core import shared\n');
    writePy(dir, 'b.py', 'from core import shared\n');
    writePy(dir, 'c.py', 'from core import shared\n');
    const graph = buildPythonDepGraph(dir);
    const top = graph.hotspots[0];
    assert.ok(top, 'should have at least one hotspot');
    assert.equal(top!.file, 'core.py', `expected core.py as top hotspot, got: ${top!.file}`);
    assert.equal(top!.fanIn, 3, `expected fanIn=3, got: ${top!.fanIn}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPythonDepGraph: extractPyExports picks up def and class names', () => {
  const dir = makeDir();
  try {
    writePy(dir, 'shapes.py', 'class Circle:\n    pass\n\ndef area(r):\n    return r * r\n\ndef _private():\n    pass\n');
    const graph = buildPythonDepGraph(dir);
    const node = graph.nodes.get('shapes.py');
    assert.ok(node!.exports.includes('Circle'), 'Circle should be exported');
    assert.ok(node!.exports.includes('area'), 'area should be exported');
    assert.ok(!node!.exports.includes('_private'), '_private should not be exported');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPythonDepGraph: files in subdirectories are discovered', () => {
  const dir = makeDir();
  try {
    mkdirSync(join(dir, 'src'));
    writePy(dir, join('src', 'helper.py'), 'def help(): pass\n');
    const graph = buildPythonDepGraph(dir);
    assert.ok(graph.nodes.size >= 1, 'should find files in subdirectories');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── formatDepReport ───────────────────────────────────────────────────────────

test('formatDepReport: summary includes module count', () => {
  const dir = makeDir();
  try {
    writePy(dir, 'a.py', '');
    writePy(dir, 'b.py', '');
    const graph = buildPythonDepGraph(dir);
    const report = formatDepReport(graph);
    assert.ok(report.includes('Modules:'), report);
    assert.ok(report.includes('2'), report);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatDepReport: cycle count in summary', () => {
  const dir = makeDir();
  try {
    writePy(dir, 'x.py', 'from y import y\n');
    writePy(dir, 'y.py', 'from x import x\n');
    const graph = buildPythonDepGraph(dir);
    const report = formatDepReport(graph);
    assert.ok(report.includes('Cycles:'), report);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
