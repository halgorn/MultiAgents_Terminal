import { Project } from 'ts-morph';
import { join, relative, dirname } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { isGeneratedArtifact, isIgnoredDirName } from '../cli/cli-utils.js';

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

  for (const sf of project.getSourceFiles()) {
    const rel = relative(cwd, sf.getFilePath());
    if (rel.startsWith('..') || rel.includes('node_modules') || isGeneratedArtifact(rel)) continue;
    nodes.set(rel, {
      file: rel,
      imports: [],
      importedBy: [],
      exports: [...sf.getExportedDeclarations().keys()].slice(0, 50),
      loc: sf.getEndLineNumber(),
    });
  }

  for (const sf of project.getSourceFiles()) {
    const rel = relative(cwd, sf.getFilePath());
    if (!nodes.has(rel)) continue;
    for (const decl of sf.getImportDeclarations()) {
      try {
        const resolved = decl.getModuleSpecifierSourceFile();
        if (!resolved) continue;
        const importedRel = relative(cwd, resolved.getFilePath());
        if (importedRel.startsWith('..') || importedRel.includes('node_modules') || isGeneratedArtifact(importedRel)) continue;
        nodes.get(rel)!.imports.push(importedRel);
        nodes.get(importedRel)?.importedBy.push(rel);
      } catch { /* skip unresolved */ }
    }
  }

  return { nodes, cycles: detectCycles(nodes), hotspots: computeHotspots(nodes) };
}

// ── Python dep graph ──────────────────────────────────────────────────────────

function collectPyFiles(cwd: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (isIgnoredDirName(entry)) continue;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      const rel = relative(cwd, full);
      if (entry.endsWith('.py') && !isGeneratedArtifact(rel)) files.push(rel);
    }
  };
  walk(cwd);
  return files;
}

function parsePyImports(content: string, fromFile: string, fileSet: Set<string>): string[] {
  const resolved: string[] = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    const spec = (/^from\s+([\w.]+)\s+import/.exec(t)?.[1]) ?? (/^import\s+([\w.]+)/.exec(t)?.[1]);
    if (!spec) continue;
    const parts = spec.split('.');
    const fileDir = dirname(fromFile);
    for (const candidate of [parts.join('/') + '.py', parts.join('/') + '/__init__.py']) {
      if (fileSet.has(join(fileDir, candidate))) { resolved.push(join(fileDir, candidate)); break; }
      if (fileSet.has(candidate)) { resolved.push(candidate); break; }
    }
  }
  return [...new Set(resolved)];
}

function extractPyExports(content: string): string[] {
  return content.split('\n')
    .flatMap((line) => { const m = /^(?:def|class|async def)\s+([A-Za-z_]\w*)/.exec(line.trim()); return m?.[1] && !m[1].startsWith('_') ? [m[1]] : []; })
    .slice(0, 50);
}

export function buildPythonDepGraph(cwd: string): DepGraph {
  const files = collectPyFiles(cwd);
  const fileSet = new Set(files);
  const nodes = new Map<string, DepNode>();

  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }
    nodes.set(file, { file, imports: [], importedBy: [], exports: extractPyExports(content), loc: content.split('\n').length });
  }
  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }
    const imports = parsePyImports(content, file, fileSet);
    nodes.get(file)!.imports = imports;
    for (const imp of imports) nodes.get(imp)?.importedBy.push(file);
  }

  return { nodes, cycles: detectCycles(nodes), hotspots: computeHotspots(nodes) };
}

// ── Auto-detect language and build graph ─────────────────────────────────────

export function buildDepGraphAuto(cwd: string, lang?: string): DepGraph {
  return lang === 'python' ? buildPythonDepGraph(cwd) : buildDepGraph(cwd);
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function computeHotspots(nodes: Map<string, DepNode>) {
  return [...nodes.values()]
    .map((n) => ({ file: n.file, fanIn: n.importedBy.length, fanOut: n.imports.length, score: n.importedBy.length * 2 + n.imports.length + Math.floor(n.loc / 100) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

function detectCycles(nodes: Map<string, DepNode>): string[][] {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) { const s = path.indexOf(node); if (s !== -1) cycles.push(path.slice(s)); return; }
    if (visited.has(node)) return;
    visited.add(node); inStack.add(node);
    for (const imp of nodes.get(node)?.imports ?? []) dfs(imp, [...path, node]);
    inStack.delete(node);
  }

  for (const file of nodes.keys()) dfs(file, []);
  return cycles.slice(0, 20);
}

export function formatDepReport(graph: DepGraph): string {
  const lines: string[] = ['# Dependency Graph Report\n'];
  lines.push(`## Summary\n- Modules: ${graph.nodes.size}\n- Cycles: ${graph.cycles.length}\n`);
  lines.push(`## Hotspots (high coupling)`);
  for (const h of graph.hotspots.slice(0, 10)) lines.push(`- \`${h.file}\` — fan-in: ${h.fanIn}, fan-out: ${h.fanOut}`);
  if (graph.cycles.length > 0) {
    lines.push(`\n## Circular Dependencies`);
    for (const cycle of graph.cycles) lines.push(`- ${cycle.join(' → ')}`);
  }
  return lines.join('\n');
}
