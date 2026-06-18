import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { AI_RUNTIME_DIR } from './paths.js';

export const PROJECT_SCHEMA_VERSION = 1 as const;
export const VECTORS_FILE = 'project.vectors.bin';
export const PROJECT_FILE = 'project.json';

export interface RepoFile {
  path: string;
  ext: string;
  loc: number;
  bytes: number;
  isTest: boolean;
}

export interface RepoSymbol {
  name: string;
  kind: 'function' | 'class' | 'method' | 'const' | 'unknown';
  file: string;
  line: number;
}

export interface RepoImport {
  from: string;
  specifier: string;
  resolved?: string;
}

export interface RepoChunk {
  file: string;
  name: string;
  type: 'function' | 'class' | 'method' | 'block' | 'arrow_function' | 'export_statement' | 'variable_declaration';
  startLine: number;
  endLine: number;
  tokens: number;
}

export interface TestLink {
  source: string;
  tests: string[];
}

export interface DepNode {
  file: string;
  imports: string[];
  importedBy: string[];
  exports: string[];
  loc: number;
}

export interface DepHotspot {
  file: string;
  fanIn: number;
  fanOut: number;
  score: number;
}

export interface EmbeddingMetadata {
  model: string;
  dim: number;
  vectorsPath: string;
  count: number;
}

export interface DepMetadata {
  nodes: DepNode[];
  cycles: string[][];
  hotspots: DepHotspot[];
}

export interface ProjectStoreStats {
  files: number;
  symbols: number;
  imports: number;
  chunks: number;
  testLinks: number;
  vectors: number;
  modules: number;
  cycles: number;
  durationMs: number;
}

export interface ProjectStore {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  generatedAt: string;
  root: string;
  repoHash: string;
  files: RepoFile[];
  symbols: RepoSymbol[];
  imports: RepoImport[];
  chunks: RepoChunk[];
  tests: TestLink[];
  embeddings: EmbeddingMetadata;
  deps: DepMetadata;
  stats: ProjectStoreStats;
}

export function computeRepoHash(files: ReadonlyArray<{ path: string; bytes: number; loc: number }>): string {
  const minimal = files
    .map((f) => `${f.path}:${f.bytes}:${f.loc}`)
    .sort()
    .join('|');
  return createHash('sha1').update(minimal).digest('hex');
}

export function projectStorePath(cwd: string): string {
  return join(cwd, AI_RUNTIME_DIR, PROJECT_FILE);
}

export function projectVectorsPath(cwd: string): string {
  return join(cwd, AI_RUNTIME_DIR, VECTORS_FILE);
}

export function readProjectStore(cwd: string): ProjectStore | null {
  const path = projectStorePath(cwd);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ProjectStore;
    if (parsed.schemaVersion !== PROJECT_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeProjectStore(cwd: string, store: ProjectStore): string {
  const path = projectStorePath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf8');
  return path;
}

export function writeVectors(cwd: string, vectors: Float32Array, dim: number): string {
  const path = projectVectorsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const buffer = Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength);
  writeFileSync(path, buffer);
  return path;
}

export function readVectors(cwd: string): Float32Array | null {
  const path = projectVectorsPath(cwd);
  if (!existsSync(path)) return null;
  try {
    const buffer = readFileSync(path);
    if (buffer.length === 0) return null;
    const totalFloats = buffer.length / Float32Array.BYTES_PER_ELEMENT;
    if (!Number.isInteger(totalFloats)) return null;
    return new Float32Array(buffer.buffer, buffer.byteOffset, totalFloats);
  } catch {
    return null;
  }
}

export function isProjectStoreFresh(cwd: string, files: ReadonlyArray<{ path: string; bytes: number; loc: number }>): boolean {
  const store = readProjectStore(cwd);
  if (!store) return false;
  return store.repoHash === computeRepoHash(files);
}
