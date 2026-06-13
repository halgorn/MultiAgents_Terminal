import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { DepGraph } from './dep-graph.js';
import { AI_RUNTIME_DIR } from './paths.js';

// ── Adjacency store ───────────────────────────────────────────────────────────
// Stores dep-graph as { nodes: {file, loc, exports[]}, edges: [from, to][] }
// Cached in .ai-runtime/dep-graph.json — rebuilt on demand.

interface StoredGraph {
  nodes: Array<{ file: string; loc: number; exports: string[] }>;
  edges: Array<[string, string]>; // [from, to] = "from imports to"
  builtAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function storedPath(cwd: string): string {
  return join(cwd, AI_RUNTIME_DIR, 'dep-graph.json');
}

export function saveDepGraph(cwd: string, graph: DepGraph): void {
  const nodes = [...graph.nodes.values()].map((n) => ({
    file: n.file, loc: n.loc, exports: n.exports,
  }));
  const edges: Array<[string, string]> = [];
  for (const node of graph.nodes.values()) {
    for (const imp of node.imports) edges.push([node.file, imp]);
  }
  const stored: StoredGraph = { nodes, edges, builtAt: Date.now() };
  mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
  writeFileSync(storedPath(cwd), JSON.stringify(stored), 'utf8');
}

export function loadDepGraph(cwd: string): StoredGraph | null {
  try {
    const raw = JSON.parse(readFileSync(storedPath(cwd), 'utf8')) as StoredGraph;
    if (Date.now() - raw.builtAt > CACHE_TTL_MS) return null; // stale
    return raw;
  } catch { return null; }
}

export function isDepGraphCached(cwd: string): boolean {
  return loadDepGraph(cwd) !== null;
}

// ── Impact Analysis ───────────────────────────────────────────────────────────

export interface ImpactResult {
  changedFile: string;
  directImporters: string[];
  transitiveFiles: string[];
  totalImpact: number;
  hotspotOverlap: string[]; // files that are both impacted and hotspots
}

export function computeImpact(graph: StoredGraph, changedFile: string, hotspotFiles: string[] = []): ImpactResult {
  // Build reverse adjacency: file → files that import it
  const reverseEdges = new Map<string, string[]>();
  for (const [from, to] of graph.edges) {
    const list = reverseEdges.get(to) ?? [];
    list.push(from);
    reverseEdges.set(to, list);
  }

  const directImporters = reverseEdges.get(changedFile) ?? [];

  // BFS for transitive impact
  const visited = new Set<string>();
  const queue = [...directImporters];
  while (queue.length) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const importer of reverseEdges.get(cur) ?? []) {
      if (!visited.has(importer)) queue.push(importer);
    }
  }

  const transitiveFiles = [...visited].filter((f) => !directImporters.includes(f)).sort();
  const hotspotSet = new Set(hotspotFiles);
  const hotspotOverlap = [...visited].filter((f) => hotspotSet.has(f)).sort();

  return {
    changedFile,
    directImporters: directImporters.sort(),
    transitiveFiles,
    totalImpact: visited.size,
    hotspotOverlap,
  };
}

export function formatImpactReport(result: ImpactResult): string {
  const lines: string[] = [];
  lines.push(`Impact analysis: ${result.changedFile}`);
  lines.push(`Total affected: ${result.totalImpact} file(s)\n`);

  if (result.directImporters.length === 0) {
    lines.push('No files import this module directly.');
    return lines.join('\n');
  }

  lines.push(`Direct importers (${result.directImporters.length}):`);
  for (const f of result.directImporters) lines.push(`  → ${f}`);

  if (result.transitiveFiles.length > 0) {
    lines.push(`\nTransitive impact (${result.transitiveFiles.length} more):`);
    for (const f of result.transitiveFiles.slice(0, 20)) lines.push(`  ↪ ${f}`);
    if (result.transitiveFiles.length > 20) lines.push(`  ... and ${result.transitiveFiles.length - 20} more`);
  }

  if (result.hotspotOverlap.length > 0) {
    lines.push(`\nHotspot overlap (${result.hotspotOverlap.length} high-risk files also affected):`);
    for (const f of result.hotspotOverlap) lines.push(`  ⚠ ${f}`);
  }

  const risk = result.totalImpact > 20 ? 'HIGH' : result.totalImpact > 5 ? 'MEDIUM' : 'LOW';
  lines.push(`\nRisk: ${risk}`);
  return lines.join('\n');
}
