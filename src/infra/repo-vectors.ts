import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { RepoChunk, RepoIndex } from './repo-index.js';
import { cosineSimilarity, embedBatch, embedText, embeddingProvider } from './embeddings.js';
import { AI_RUNTIME_DIR } from './paths.js';

interface RepoVectorEntry {
  file: string;
  name: string;
  type: RepoChunk['type'];
  startLine: number;
  endLine: number;
  text: string;
  vector: number[];
}

interface RepoVectorIndex {
  version: 1;
  repoHash: string;
  generatedAt: string;
  embeddingProvider: string;
  entries: RepoVectorEntry[];
}

export interface RepoVectorResult {
  file: string;
  name: string;
  type: RepoChunk['type'];
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

function indexPath(cwd: string): string {
  return join(cwd, AI_RUNTIME_DIR, 'repo-vectors.json');
}

function hashIndex(index: RepoIndex, provider: string): string {
  return createHash('sha1')
    .update(JSON.stringify({
      provider,
      files: index.files.map((f) => [f.path, f.bytes, f.loc]),
      chunks: index.chunks.map((c) => [c.file, c.name, c.startLine, c.endLine, c.tokens]),
    }))
    .digest('hex');
}

function readChunkText(cwd: string, chunk: RepoChunk): string {
  try {
    const lines = readFileSync(join(cwd, chunk.file), 'utf8').split('\n');
    // Read the full AST chunk (no 80-line cap — chunker.ts already handles boundaries)
    return lines.slice(chunk.startLine - 1, chunk.endLine).join('\n').trim();
  } catch {
    return '';
  }
}

export async function buildRepoVectorIndex(cwd: string, index: RepoIndex, onProgress?: (done: number, total: number) => void): Promise<RepoVectorIndex> {
  const provider = embeddingProvider();
  const payloads: string[] = [];
  const meta: Array<Omit<RepoVectorEntry, 'vector'>> = [];

  for (const chunk of index.chunks) {
    const text = readChunkText(cwd, chunk);
    if (!text) continue;
    const payload = `${chunk.file}\n${chunk.name}\n${chunk.type}\n${text}`;
    payloads.push(payload);
    meta.push({
      file: chunk.file,
      name: chunk.name,
      type: chunk.type,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: text.slice(0, 1200),
    });
  }

  // Batch embed in groups of 32 to show progress and limit memory
  const BATCH = 32;
  const allVectors: number[][] = [];
  for (let i = 0; i < payloads.length; i += BATCH) {
    const batch = payloads.slice(i, i + BATCH);
    const vecs = await embedBatch(batch);
    allVectors.push(...vecs);
    onProgress?.(Math.min(i + BATCH, payloads.length), payloads.length);
  }

  const entries: RepoVectorEntry[] = meta.map((m, i) => ({
    ...m,
    vector: allVectors[i] ?? [],
  }));

  const vectorIndex: RepoVectorIndex = {
    version: 1,
    repoHash: hashIndex(index, provider),
    generatedAt: new Date().toISOString(),
    embeddingProvider: provider,
    entries,
  };
  const path = indexPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(vectorIndex), 'utf8');
  return vectorIndex;
}

export function loadRepoVectorIndex(cwd: string, index: RepoIndex): RepoVectorIndex | null {
  try {
    const path = indexPath(cwd);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as RepoVectorIndex;
    if (parsed.version !== 1) return null;
    const provider = embeddingProvider();
    if (parsed.repoHash !== hashIndex(index, provider)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function ensureRepoVectorIndex(cwd: string, index: RepoIndex, rebuild = false, onProgress?: (done: number, total: number) => void): Promise<RepoVectorIndex> {
  if (!rebuild) {
    const cached = loadRepoVectorIndex(cwd, index);
    if (cached) return cached;
  }
  return buildRepoVectorIndex(cwd, index, onProgress);
}

export async function queryRepoVectors(vectorIndex: RepoVectorIndex, query: string, limit = 10): Promise<RepoVectorResult[]> {
  const vecs = await embedBatch([query]);
  const queryVector = new Float32Array(vecs[0] ?? Array.from(embedText(query, 1000)));
  return vectorIndex.entries
    .map((entry) => ({
      ...entry,
      score: cosineSimilarity(queryVector, new Float32Array(entry.vector)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, limit);
}
