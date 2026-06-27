import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'node:crypto';
import { Project } from 'ts-morph';
import { shouldExcludePath } from '../security/exclude-list.js';
import { isGeneratedArtifact } from './file-filter.js';

export interface DepNode {
  file: string;
  imports: string[];
  importedBy: string[];
  exports: string[];
  loc: number;
}

export interface DepGraph {
  nodes: Map<string, DepNode>;
  cycles: string[][];
  hotspots: Array<{ file: string; fanIn: number; fanOut: number; score: number }>;
}

interface CachedDepGraph {
  schemaVersion: 1;
  repoHash: string;
  generatedAt: string;
  graph: {
    nodes: Array<[string, DepNode]>;
    cycles: string[][];
    hotspots: Array<{ file: string; fanIn: number; fanOut: number; score: number }>;
  };
}

const CACHE_FILE = 'dep-graph-cache.json';

function buildRepoHash(cwd: string): string {
  const pkgPath = join(cwd, 'package.json');
  const tsconfigPath = join(cwd, 'tsconfig.json');
  const h = createHash('sha1');
  if (existsSync(pkgPath)) h.update(readFileSync(pkgPath));
  if (existsSync(tsconfigPath)) h.update(readFileSync(tsconfigPath));
  return h.digest('hex').slice(0, 16);
}

function readCache(cwd: string, repoHash: string): DepGraph | null {
  const path = join(cwd, '.ai-runtime', CACHE_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as CachedDepGraph;
    if (raw.schemaVersion !== 1 || raw.repoHash !== repoHash) return null;
    return {
      nodes: new Map(raw.graph.nodes),
      cycles: raw.graph.cycles,
      hotspots: raw.graph.hotspots,
    };
  } catch {
    return null;
  }
}

function writeCache(cwd: string, repoHash: string, graph: DepGraph): void {
  const path = join(cwd, '.ai-runtime', CACHE_FILE);
  mkdirSync(join(cwd, '.ai-runtime'), { recursive: true });
  const payload: CachedDepGraph = {
    schemaVersion: 1,
    repoHash,
    generatedAt: new Date().toISOString(),
    graph: {
      nodes: Array.from(graph.nodes.entries()),
      cycles: graph.cycles,
      hotspots: graph.hotspots,
    },
  };
  writeFileSync(path, JSON.stringify(payload), 'utf8');
}

function computeHotspots(nodes: Map<string, DepNode>): DepGraph['hotspots'] {
  const hotspots: Array<{ file: string; fanIn: number; fanOut: number; score: number }> = [];
  for (const [file, node] of nodes) {
    const fanIn = node.importedBy.length;
    const fanOut = node.imports.length;
    const score = fanIn * 2 + fanOut + (node.loc > 500 ? 5 : 0);
    if (score > 0) hotspots.push({ file, fanIn, fanOut, score });
  }
  hotspots.sort((a, b) => b.score - a.score);
  return hotspots.slice(0, 50);
}

function detectCycles(nodes: Map<string, DepNode>): string[][] {
  const cycles: string[][] = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const path: string[] = [];
  function dfs(node: string): void {
    color.set(node, GRAY);
    path.push(node);
    const n = nodes.get(node);
    if (n) {
      for (const imp of n.imports) {
        if (!nodes.has(imp)) continue;
        const c = color.get(imp);
        if (c === GRAY) {
          const cycleStart = path.indexOf(imp);
          if (cycleStart >= 0) cycles.push([...path.slice(cycleStart), imp]);
        } else if (c === undefined || c === WHITE) {
          dfs(imp);
        }
      }
    }
    color.set(node, BLACK);
    path.pop();
  }
  for (const f of nodes.keys()) {
    if (color.get(f) === undefined) dfs(f);
  }
  return cycles;
}

export function buildDepGraph(cwd: string, opts: { skipCache?: boolean } = {}): DepGraph {
  const repoHash = buildRepoHash(cwd);
  if (!opts.skipCache) {
    const cached = readCache(cwd, repoHash);
    if (cached) return cached;
  }

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
    if (shouldExcludePath(rel).excluded) continue;
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
    const node = nodes.get(rel);
    if (!node) continue;
    const seen = new Set<string>();
    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      if (!spec.startsWith('.') || seen.has(spec)) continue;
      seen.add(spec);
      node.imports.push(spec);
    }
  }

  for (const [, node] of nodes) {
    for (const imp of node.imports) {
      const target = nodes.get(imp);
      if (target && !target.importedBy.includes(node.file)) {
        target.importedBy.push(node.file);
      }
    }
  }

  const hotspots = computeHotspots(nodes);
  const cycles = detectCycles(nodes);
  const graph: DepGraph = { nodes, cycles, hotspots };

  if (!opts.skipCache) {
    try { writeCache(cwd, repoHash, graph); } catch { /* cache write best-effort */ }
  }

  return graph;
}