import { Project } from 'ts-morph';
import { join, relative } from 'path';
import { existsSync } from 'fs';

export interface DepNode {
  file: string;           // relative path
  imports: string[];      // files this module imports
  importedBy: string[];   // files that import this module
  exports: string[];      // exported symbol names
  loc: number;            // lines of code
}

export interface DepGraph {
  nodes: Map<string, DepNode>;
  cycles: string[][];
  hotspots: Array<{ file: string; fanIn: number; fanOut: number; score: number }>;
}

export function buildDepGraph(cwd: string): DepGraph {
  const tsconfigPath = join(cwd, 'tsconfig.json');
  const project = existsSync(tsconfigPath)
    ? new Project({ tsConfigFilePath: tsconfigPath, skipAddingFilesFromTsConfig: false })
    : new Project({ compilerOptions: { allowJs: true } });

  if (!existsSync(tsconfigPath)) {
    project.addSourceFilesAtPaths([join(cwd, 'src/**/*.ts'), join(cwd, 'src/**/*.tsx')]);
  }

  const nodes = new Map<string, DepNode>();

  // First pass: collect all files and their exports
  for (const sf of project.getSourceFiles()) {
    const rel = relative(cwd, sf.getFilePath());
    if (rel.startsWith('..') || rel.includes('node_modules')) continue;

    nodes.set(rel, {
      file: rel,
      imports: [],
      importedBy: [],
      exports: [...sf.getExportedDeclarations().keys()].slice(0, 50),
      loc: sf.getEndLineNumber(),
    });
  }

  // Second pass: resolve imports
  for (const sf of project.getSourceFiles()) {
    const rel = relative(cwd, sf.getFilePath());
    if (!nodes.has(rel)) continue;

    for (const decl of sf.getImportDeclarations()) {
      try {
        const resolved = decl.getModuleSpecifierSourceFile();
        if (!resolved) continue;
        const importedRel = relative(cwd, resolved.getFilePath());
        if (importedRel.startsWith('..') || importedRel.includes('node_modules')) continue;

        nodes.get(rel)!.imports.push(importedRel);
        nodes.get(importedRel)?.importedBy.push(rel);
      } catch { /* skip unresolved */ }
    }
  }

  // Detect cycles using DFS
  const cycles = detectCycles(nodes);

  // Hotspots: files with high fan-in (many importers) or fan-out (many imports)
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

function detectCycles(nodes: Map<string, DepNode>): string[][] {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) cycles.push(path.slice(cycleStart));
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    for (const imp of nodes.get(node)?.imports ?? []) {
      dfs(imp, [...path, node]);
    }

    inStack.delete(node);
  }

  for (const file of nodes.keys()) dfs(file, []);
  return cycles.slice(0, 20); // cap at 20 cycles
}

export function formatDepReport(graph: DepGraph): string {
  const lines: string[] = ['# Dependency Graph Report\n'];

  lines.push(`## Summary`);
  lines.push(`- Modules: ${graph.nodes.size}`);
  lines.push(`- Cycles: ${graph.cycles.length}`);
  lines.push('');

  lines.push(`## Hotspots (high coupling)`);
  for (const h of graph.hotspots.slice(0, 10)) {
    lines.push(`- \`${h.file}\` — fan-in: ${h.fanIn}, fan-out: ${h.fanOut}`);
  }
  lines.push('');

  if (graph.cycles.length > 0) {
    lines.push(`## Circular Dependencies`);
    for (const cycle of graph.cycles) {
      lines.push(`- ${cycle.join(' → ')}`);
    }
  }

  return lines.join('\n');
}
