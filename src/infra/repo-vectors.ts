import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { RepoChunk, RepoIndex } from './repo-index.js';
import { cosineSimilarity, embedText } from './embeddings.js';

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
  return join(cwd, '.ai-runtime', 'repo-vectors.json');
}

function hashIndex(index: RepoIndex): string {
  return createHash('sha1')
    .update(JSON.stringify({
      files: index.files.map((f) => [f.path, f.bytes, f.loc]),
      chunks: index.chunks.map((c) => [c.file, c.name, c.startLine, c.endLine, c.tokens]),
    }))
    .digest('hex');
}

function readChunkText(cwd: string, chunk: RepoChunk): string {
  try {
    const lines = readFileSync(join(cwd, chunk.file), 'utf8').split('\n');
    return lines.slice(chunk.startLine - 1, Math.min(chunk.endLine, chunk.startLine + 80)).join('\n').trim();
  } catch {
    return '';
  }
}

export function buildRepoVectorIndex(cwd: string, index: RepoIndex): RepoVectorIndex {
  const entries = index.chunks.map((chunk) => {
    const text = readChunkText(cwd, chunk);
    const payload = `${chunk.file}\n${chunk.name}\n${chunk.type}\n${text}`;
    return {
      file: chunk.file,
      name: chunk.name,
      type: chunk.type,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: text.slice(0, 1200),
      vector: Array.from(embedText(payload, 3000)),
    };
  });
  const vectorIndex: RepoVectorIndex = {
    version: 1,
    repoHash: hashIndex(index),
    generatedAt: new Date().toISOString(),
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
    if (parsed.version !== 1 || parsed.repoHash !== hashIndex(index)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function ensureRepoVectorIndex(cwd: string, index: RepoIndex, rebuild = false): RepoVectorIndex {
  if (!rebuild) {
    const cached = loadRepoVectorIndex(cwd, index);
    if (cached) return cached;
  }
  return buildRepoVectorIndex(cwd, index);
}

export function queryRepoVectors(vectorIndex: RepoVectorIndex, query: string, limit = 10): RepoVectorResult[] {
  const queryVector = embedText(query, 1000);
  return vectorIndex.entries
    .map((entry) => ({
      ...entry,
      score: cosineSimilarity(queryVector, new Float32Array(entry.vector)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, limit);
}
