import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { AI_RUNTIME_DIR } from './paths.js';
import {
  PROJECT_SCHEMA_VERSION,
  VECTORS_FILE,
  type EmbeddingMetadata,
  type ProjectStore,
  type RepoFile,
  type RepoImport,
  type RepoSymbol,
  type RepoChunk,
  type TestLink,
} from './project-store.js';

interface LegacyRepoIndex {
  version: 1;
  generatedAt: string;
  root: string;
  files: RepoFile[];
  symbols: RepoSymbol[];
  imports: RepoImport[];
  chunks: RepoChunk[];
  tests: TestLink[];
  stats: { files: number; symbols: number; imports: number; chunks: number; testLinks: number };
}

interface LegacyRepoVectorEntry {
  file: string;
  name: string;
  type: RepoChunk['type'];
  startLine: number;
  endLine: number;
  text: string;
  vector: number[];
}

interface LegacyRepoVectorIndex {
  version: 1;
  repoHash: string;
  generatedAt: string;
  embeddingProvider: string;
  entries: LegacyRepoVectorEntry[];
}

export interface MigrationResult {
  store: ProjectStore;
  migratedFrom: { repoIndex: boolean; repoVectors: boolean };
  vectorCount: number;
}

function readLegacyRepoIndex(cwd: string): LegacyRepoIndex | null {
  const path = join(cwd, AI_RUNTIME_DIR, 'repo-index.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LegacyRepoIndex>;
    if (parsed.version !== 1) return null;
    if (!parsed.files || !parsed.chunks) return null;
    return parsed as LegacyRepoIndex;
  } catch {
    return null;
  }
}

function readLegacyRepoVectors(cwd: string): LegacyRepoVectorIndex | null {
  const path = join(cwd, AI_RUNTIME_DIR, 'repo-vectors.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LegacyRepoVectorIndex>;
    if (parsed.version !== 1) return null;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed as LegacyRepoVectorIndex;
  } catch {
    return null;
  }
}

function hashFiles(files: RepoFile[]): string {
  return createHash('sha1')
    .update(files.map((f) => `${f.path}:${f.bytes}:${f.loc}`).sort().join('|'))
    .digest('hex');
}

export function migrateFromLegacy(cwd: string): MigrationResult | null {
  const legacy = readLegacyRepoIndex(cwd);
  if (!legacy) return null;

  const legacyVectors = readLegacyRepoVectors(cwd);

  let totalFloats = 0;
  let dim = 0;
  if (legacyVectors) {
    for (const entry of legacyVectors.entries) {
      if (entry.vector && entry.vector.length > 0) {
        if (dim === 0) dim = entry.vector.length;
        totalFloats += entry.vector.length;
      }
    }
  }

  const embeddings: EmbeddingMetadata = {
    model: legacyVectors?.embeddingProvider ?? 'unknown',
    dim: dim || 0,
    vectorsPath: legacyVectors ? VECTORS_FILE : '',
    count: legacyVectors?.entries.length ?? 0,
  };

  const store: ProjectStore = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    root: legacy.root,
    repoHash: hashFiles(legacy.files),
    files: legacy.files,
    symbols: legacy.symbols,
    imports: legacy.imports,
    chunks: legacy.chunks,
    tests: legacy.tests,
    embeddings,
    deps: { nodes: [], cycles: [], hotspots: [] },
    stats: {
      files: legacy.stats.files,
      symbols: legacy.stats.symbols,
      imports: legacy.stats.imports,
      chunks: legacy.stats.chunks,
      testLinks: legacy.stats.testLinks,
      vectors: legacyVectors?.entries.length ?? 0,
      modules: 0,
      cycles: 0,
      durationMs: 0,
    },
  };

  return {
    store,
    migratedFrom: { repoIndex: true, repoVectors: !!legacyVectors },
    vectorCount: legacyVectors?.entries.length ?? 0,
  };
}

export function needsMigration(cwd: string): boolean {
  if (!existsSync(join(cwd, AI_RUNTIME_DIR, 'repo-index.json'))) return false;
  if (!existsSync(join(cwd, AI_RUNTIME_DIR, 'project.json'))) return true;
  const projectPath = join(cwd, AI_RUNTIME_DIR, 'project.json');
  try {
    const parsed = JSON.parse(readFileSync(projectPath, 'utf8')) as { schemaVersion?: number };
    return parsed.schemaVersion !== PROJECT_SCHEMA_VERSION;
  } catch {
    return true;
  }
}
