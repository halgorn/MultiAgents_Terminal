import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import type { DepGraph, DepNode } from './dep-graph.js';

const IGNORE_DIRS = new Set([
  '__pycache__', '.git', 'node_modules', 'dist', 'build',
  '.venv', 'venv', 'env', '.env', 'site-packages',
]);

function collectPyFiles(cwd: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (entry.endsWith('.py')) files.push(relative(cwd, full));
    }
  };
  walk(cwd);
  return files;
}

function parseImports(content: string, fromFile: string, allFiles: Set<string>, cwd: string): string[] {
  const resolved: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // import foo.bar or from foo.bar import baz
    const fromMatch = /^from\s+([\w.]+)\s+import/.exec(trimmed);
    const importMatch = /^import\s+([\w.]+)/.exec(trimmed);
    const spec = fromMatch?.[1] ?? importMatch?.[1];
    if (!spec) continue;

    // Convert dot-notation to path
    const parts = spec.split('.');
    const candidates = [
      parts.join('/') + '.py',
      parts.join('/') + '/__init__.py',
    ];

    // Relative resolution from file's directory
    const fileDir = dirname(fromFile);
    for (const candidate of candidates) {
      const relFromFile = join(fileDir, candidate);
      const relFromRoot = candidate;
      if (allFiles.has(relFromFile)) { resolved.push(relFromFile); break; }
      if (allFiles.has(relFromRoot)) { resolved.push(relFromRoot); break; }
    }
  }

  return [...new Set(resolved)];
}

function countLines(content: string): number {
  return content.split('\n').length;
}

function detectCyclesPy(nodes: Map<string, DepNode>): string[][] {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const start = path.indexOf(node);
      if (start !== -1) cycles.push(path.slice(start));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    inStack.add(node);
    for (const imp of nodes.get(node)?.imports ?? []) dfs(imp, [...path, node]);
    inStack.delete(node);
  }

  for (const file of nodes.keys()) dfs(file, []);
  return cycles.slice(0, 20);
}

export function buildPythonDepGraph(cwd: string): DepGraph {
  const files = collectPyFiles(cwd);
  const fileSet = new Set(files);
  const nodes = new Map<string, DepNode>();

  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }
    nodes.set(file, {
      file,
      imports: [],
      importedBy: [],
      exports: extractExports(content),
      loc: countLines(content),
    });
  }

  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }
    const imports = parseImports(content, file, fileSet, cwd);
    nodes.get(file)!.imports = imports;
    for (const imp of imports) {
      nodes.get(imp)?.importedBy.push(file);
    }
  }

  const cycles = detectCyclesPy(nodes);
  const hotspots = [...nodes.values()]
    .map((n) => ({
      file: n.file,
      fanIn: n.importedBy.length,
      fanOut: n.imports.length,
      score: n.importedBy.length * 2 + n.imports.length + Math.floor(n.loc / 100),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  return { nodes, cycles, hotspots };
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  for (const line of content.split('\n')) {
    const m = /^(?:def|class|async def)\s+([A-Za-z_]\w*)/.exec(line.trim());
    if (m?.[1] && !m[1].startsWith('_')) exports.push(m[1]);
  }
  return exports.slice(0, 50);
}
