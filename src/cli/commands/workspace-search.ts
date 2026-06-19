import type { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { readProjectStore, type ProjectStore } from '../../infra/project-store.js';
import { readWorkspaceConfig, resolveRepoPath, type WorkspaceConfig, type WorkspaceRepo } from '../../infra/workspace.js';
import { embedText, cosineSimilarity, embeddingProvider } from '../../infra/embeddings.js';
import { readVectors } from '../../infra/project-store.js';
import { defaultLogPath } from '../../mcp/log-file.js';
import { listRepos } from './workspace.js';

export interface WorkspaceSearchResult {
  repo: WorkspaceRepo;
  file: string;
  name: string;
  type: string;
  startLine: number;
  endLine: number;
  score: number;
}

export interface WorkspaceSearchOptions {
  workspaceRoot: string;
  query: string;
  topK?: number;
  perRepoLimit?: number;
}

export async function runWorkspaceSearch(options: WorkspaceSearchOptions): Promise<{ results: WorkspaceSearchResult[]; reposSearched: number; totalDurationMs: number }> {
  const start = Date.now();
  const config = readWorkspaceConfig(options.workspaceRoot);
  if (!config) throw new Error(`No workspace.json in ${options.workspaceRoot}. Run \`aion workspace init\`.`);

  const topK = options.topK ?? 10;
  const perRepoLimit = options.perRepoLimit ?? 5;
  const allResults: WorkspaceSearchResult[] = [];
  let reposSearched = 0;

  const queryVec = await buildQueryVector(options.query);

  for (const repo of config.repos) {
    const repoPath = resolveRepoPath(options.workspaceRoot, repo);
    const store = readProjectStore(repoPath);
    const vectors = readVectors(repoPath);
    if (!store || !vectors) continue;
    reposSearched++;

    const fileHashes = new Map<string, number[]>();
    let cursor = 0;
    for (const chunk of store.chunks) {
      const expectedLen = (cursor + 1) * (store.embeddings.dim || 384);
      if (cursor + (store.embeddings.dim || 384) > vectors.length) break;
      const slice = vectors.slice(cursor, cursor + (store.embeddings.dim || 384));
      fileHashes.set(`${chunk.file}:${chunk.name}`, Array.from(slice));
      cursor += store.embeddings.dim || 384;
    }

    const scored: WorkspaceSearchResult[] = [];
    for (const chunk of store.chunks) {
      const v = fileHashes.get(`${chunk.file}:${chunk.name}`);
      if (!v) continue;
      const score = cosineSimilarity(queryVec, new Float32Array(v));
      if (score > 0) {
        scored.push({
          repo,
          file: chunk.file,
          name: chunk.name,
          type: chunk.type,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score,
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    allResults.push(...scored.slice(0, perRepoLimit));
  }

  allResults.sort((a, b) => b.score - a.score);
  return { results: allResults.slice(0, topK), reposSearched, totalDurationMs: Date.now() - start };
}

async function buildQueryVector(query: string): Promise<Float32Array> {
  const { embedTextRemote } = await import('../../infra/embeddings.js');
  const remote = await embedTextRemote(query);
  if (remote) return new Float32Array(remote);
  return embedText(query, 2000);
}

export function renderWorkspaceSearchMarkdown(result: { results: WorkspaceSearchResult[]; query: string; reposSearched: number }): string {
  const lines: string[] = [];
  lines.push(`# Workspace search: "${result.query}"\n`);
  lines.push(`Searched ${result.reposSearched} repo(s). ${result.results.length} result(s).\n`);
  const byRepo = new Map<string, WorkspaceSearchResult[]>();
  for (const r of result.results) {
    const key = r.repo.path;
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key)!.push(r);
  }
  for (const [repoPath, results] of byRepo) {
    lines.push(`\n## ${repoPath}\n`);
    for (const r of results) {
      lines.push(`- **${r.file}:${r.startLine}-${r.endLine}** — \`${r.name}\` (${r.type}) — score ${(r.score * 100).toFixed(1)}%`);
    }
  }
  return lines.join('\n');
}

export function renderWorkspaceWikiMarkdown(config: WorkspaceConfig, stores: Map<string, ProjectStore>): string {
  const lines: string[] = [];
  lines.push(`# Workspace: ${config.name}\n`);
  lines.push(`Root: \`${config.root}\`\n`);
  lines.push(`Repos: ${config.repos.length}\n`);
  lines.push(`Created: ${config.createdAt}\n`);
  lines.push(`Updated: ${config.updatedAt}\n`);

  let totalFiles = 0;
  let totalSymbols = 0;
  let totalChunks = 0;
  let totalCycles = 0;
  let totalModules = 0;

  for (const store of stores.values()) {
    totalFiles += store.stats.files;
    totalSymbols += store.stats.symbols;
    totalChunks += store.stats.chunks;
    totalCycles += store.stats.cycles;
    totalModules += store.stats.modules;
  }

  lines.push(`\n## Aggregated stats\n`);
  lines.push(`- Files: ${totalFiles}`);
  lines.push(`- Symbols: ${totalSymbols}`);
  lines.push(`- Chunks: ${totalChunks}`);
  lines.push(`- Modules: ${totalModules}`);
  lines.push(`- Cycles: ${totalCycles}`);

  lines.push(`\n## Repositories\n`);
  for (const repo of config.repos) {
    const store = stores.get(repo.path);
    if (!store) {
      lines.push(`### ${repo.path}\n\n_No PIL found. Run \`aion sync\` in this repo._\n`);
      continue;
    }
    lines.push(`### ${repo.path}\n`);
    lines.push(`- Files: ${store.stats.files} · Symbols: ${store.stats.symbols} · Chunks: ${store.stats.chunks}`);
    lines.push(`- Modules: ${store.stats.modules} · Cycles: ${store.stats.cycles}`);
    if (store.deps.hotspots.length > 0) {
      const top = store.deps.hotspots[0];
      lines.push(`- Top hotspot: \`${top.file}\` (fan-in ${top.fanIn}, fan-out ${top.fanOut})`);
    }
    if (store.deps.cycles.length > 0) {
      lines.push(`- ⚠ ${store.deps.cycles.length} circular dependency(ies)`);
    }
  }

  lines.push(`\n## How to use this workspace\n`);
  lines.push(`1. Run \`aion workspace sync\` to refresh all repos.`);
  lines.push(`2. Run \`aion workspace search <query>\` to search across all repos.`);
  lines.push(`3. Run \`aion workspace info\` for a quick summary.`);
  lines.push(`4. Per-repo: \`aion sync && aion wiki\` runs inside each repo.`);
  lines.push(`5. This file is auto-detected by MCP clients.`);
  return lines.join('\n');
}

export function collectWorkspaceStores(config: WorkspaceConfig): Map<string, ProjectStore> {
  const map = new Map<string, ProjectStore>();
  for (const repo of config.repos) {
    const repoPath = resolveRepoPath(config.root, repo);
    const store = readProjectStore(repoPath);
    if (store) map.set(repo.path, store);
  }
  return map;
}

export function writeWorkspaceWiki(cwd: string, content: string): string {
  const path = join(cwd, '.ai-runtime', 'WORKSPACE.md');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return path;
}

void defaultLogPath;
void embeddingProvider;
void dirname;
void listRepos;
