import type { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildRepoIndex, type RepoChunk } from '../../infra/repo-index.js';
import { buildDepGraphAuto } from '../../infra/dep-graph.js';
import { embedBatch, embeddingProvider } from '../../infra/embeddings.js';
import {
  PROJECT_SCHEMA_VERSION,
  VECTORS_FILE,
  computeRepoHash,
  writeProjectStore,
  writeVectors,
  type ProjectStore,
  type DepNode,
  type DepHotspot,
} from '../../infra/project-store.js';
import { migrateFromLegacy, needsMigration } from '../../infra/project-migrate.js';
import { writeSetupState, readSetupState, createSetupState } from '../../infra/setup/project-setup.js';

export interface SyncOptions {
  quiet?: boolean;
  json?: boolean;
  skipEmbeddings?: boolean;
  migrateOnly?: boolean;
  cwd?: string;
}

export interface SyncProgress {
  phase: 'migrate' | 'files' | 'symbols' | 'embeddings' | 'deps' | 'write' | 'done';
  done: number;
  total: number;
  message: string;
}

function readChunkText(cwd: string, chunk: RepoChunk): string {
  try {
    const lines = readFileSync(join(cwd, chunk.file), 'utf8').split('\n');
    return lines.slice(chunk.startLine - 1, chunk.endLine).join('\n').trim();
  } catch {
    return '';
  }
}

function flatFloat32(vectors: number[][]): { array: Float32Array; dim: number } {
  const dim = vectors[0]?.length ?? 0;
  const total = vectors.length * dim;
  const array = new Float32Array(total);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i] ?? [];
    for (let j = 0; j < dim; j++) array[i * dim + j] = v[j] ?? 0;
  }
  return { array, dim };
}

export interface SyncResult {
  store: ProjectStore;
  durationMs: number;
  migrated: boolean;
  embeddingsSkipped: boolean;
}

export async function runSync(
  cwd: string,
  options: SyncOptions = {},
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncResult> {
  const start = Date.now();
  const log = options.quiet ? () => {} : (s: string) => process.stdout.write(s + '\n');
  const report = (p: SyncProgress) => onProgress?.(p);

  let migrated = false;
  if (needsMigration(cwd)) {
    report({ phase: 'migrate', done: 0, total: 0, message: 'Migrating legacy files…' });
    log(chalk.dim('  migrating legacy repo-index/repo-vectors…'));
    const mig = migrateFromLegacy(cwd);
    if (mig) {
      writeProjectStore(cwd, mig.store);
      migrated = true;
    }
  }

  if (options.migrateOnly) {
    const dur = Date.now() - start;
    return {
      store: migrateFromLegacy(cwd)?.store ?? emptyStore(cwd, dur),
      durationMs: dur,
      migrated: true,
      embeddingsSkipped: true,
    };
  }

  report({ phase: 'files', done: 0, total: 0, message: 'Scanning files…' });
  log(chalk.dim('  scanning files…'));
  const index = await buildRepoIndex(cwd);

  report({ phase: 'symbols', done: 1, total: 1, message: `${index.symbols.length} symbols detected` });
  log(chalk.green(`  ✓ ${index.files.length} files · ${index.symbols.length} symbols · ${index.chunks.length} chunks`));

  let vectorsCount = 0;
  let dim = 0;
  let vectors: Float32Array = new Float32Array(0);
  let provider = embeddingProvider();

  if (!options.skipEmbeddings) {
    report({ phase: 'embeddings', done: 0, total: index.chunks.length, message: 'Generating embeddings…' });
    log(chalk.dim('  generating embeddings…'));
    const payloads: string[] = [];
    for (const chunk of index.chunks) {
      const text = readChunkText(cwd, chunk);
      if (!text) continue;
      payloads.push(`${chunk.file}\n${chunk.name}\n${chunk.type}\n${text}`);
    }
    const BATCH = 32;
    const allVectors: number[][] = [];
    for (let i = 0; i < payloads.length; i += BATCH) {
      const batch = payloads.slice(i, i + BATCH);
      const vecs = await embedBatch(batch);
      allVectors.push(...vecs);
      report({ phase: 'embeddings', done: Math.min(i + BATCH, payloads.length), total: payloads.length, message: 'embedding' });
      if (!options.quiet) process.stdout.write(`\r  embeddings: ${Math.min(i + BATCH, payloads.length)}/${payloads.length}`);
    }
    if (!options.quiet) process.stdout.write('\n');
    const flat = flatFloat32(allVectors);
    vectors = flat.array;
    dim = flat.dim;
    vectorsCount = allVectors.length;
    writeVectors(cwd, vectors, dim);
    log(chalk.green(`  ✓ ${vectorsCount} vectors (${dim}d, ${provider})`));
  } else {
    log(chalk.dim('  embeddings skipped'));
  }

  report({ phase: 'deps', done: 0, total: 1, message: 'Building dependency graph…' });
  log(chalk.dim('  building dependency graph…'));
  const depGraph = buildDepGraphAuto(cwd);
  const depNodes: DepNode[] = [...depGraph.nodes.values()];
  const depHotspots: DepHotspot[] = depGraph.hotspots.map((h) => ({ file: h.file, fanIn: h.fanIn, fanOut: h.fanOut, score: h.score }));
  log(chalk.green(`  ✓ ${depNodes.length} modules · ${depGraph.cycles.length} cycles`));

  const repoHash = computeRepoHash(index.files);
  const duration = Date.now() - start;

  const store: ProjectStore = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    root: cwd,
    repoHash,
    files: index.files,
    symbols: index.symbols,
    imports: index.imports,
    chunks: index.chunks,
    tests: index.tests,
    embeddings: {
      model: provider,
      dim,
      vectorsPath: options.skipEmbeddings ? '' : VECTORS_FILE,
      count: vectorsCount,
    },
    deps: {
      nodes: depNodes,
      cycles: depGraph.cycles,
      hotspots: depHotspots,
    },
    stats: {
      files: index.files.length,
      symbols: index.symbols.length,
      imports: index.imports.length,
      chunks: index.chunks.length,
      testLinks: index.tests.length,
      vectors: vectorsCount,
      modules: depNodes.length,
      cycles: depGraph.cycles.length,
      durationMs: duration,
    },
  };

  report({ phase: 'write', done: 0, total: 1, message: 'Writing project.json…' });
  writeProjectStore(cwd, store);
  log(chalk.green(`  ✓ project.json written (${duration}ms)`));

  const existing = readSetupState(cwd);
  if (existing) {
    writeSetupState(cwd, createSetupState(cwd, {
      ...existing,
      progress: { ...existing.progress, localIndexReady: true, dependencyMapReady: true },
    }));
  }

  report({ phase: 'done', done: 1, total: 1, message: 'Sync complete' });
  if (!options.quiet) {
    process.stdout.write(chalk.bold(`\n✓ Sync complete in ${duration}ms (PIL v${PROJECT_SCHEMA_VERSION})\n\n`));
  }
  return { store, durationMs: duration, migrated, embeddingsSkipped: !!options.skipEmbeddings };
}

function emptyStore(cwd: string, durationMs: number): ProjectStore {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    root: cwd,
    repoHash: '',
    files: [],
    symbols: [],
    imports: [],
    chunks: [],
    tests: [],
    embeddings: { model: '', dim: 0, vectorsPath: '', count: 0 },
    deps: { nodes: [], cycles: [], hotspots: [] },
    stats: { files: 0, symbols: 0, imports: 0, chunks: 0, testLinks: 0, vectors: 0, modules: 0, cycles: 0, durationMs },
  };
}

export function registerSync(program: Command): void {
  program
    .command('sync')
    .description('Unified Project Intelligence Layer sync — replaces `index`, `memory build`, `memory deps`')
    .option('--quiet', 'suppress output (for git hooks)')
    .option('--json', 'emit progress as JSON lines')
    .option('--skip-embeddings', 'skip embedding generation (faster, no semantic search)')
    .option('--migrate-only', 'only run legacy migration, do not rebuild')
    .action(async (opts: { quiet?: boolean; json?: boolean; skipEmbeddings?: boolean; migrateOnly?: boolean }) => {
      const cwd = process.cwd();
      const result = await runSync(cwd, {
        quiet: opts.quiet,
        json: opts.json,
        skipEmbeddings: opts.skipEmbeddings,
        migrateOnly: opts.migrateOnly,
      });
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: true, ...result, store: undefined, durationMs: result.durationMs }) + '\n');
      }
    });
}
