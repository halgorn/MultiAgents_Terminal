import { FlatVectorIndex, type VectorIndex } from './vectors/index.js';
import { query, type RagEngine, type RagQueryResult } from './query.js';
import { EmbeddingRegistry, HashFallbackProvider, type EmbeddingProvider } from './embeddings/registry.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const VECTORS_FILE = 'pil/vectors.bin';
const MANIFEST_FILE = 'pil/manifest.json';

export interface PilReader {
  hasManifest(): boolean;
  readManifest(): Record<string, unknown> | null;
  loadVectorIndex(): Promise<VectorIndex>;
  embed(text: string): Promise<Float32Array>;
}

let _defaultRegistry: EmbeddingRegistry | null = null;

export function getDefaultRegistry(): EmbeddingRegistry {
  if (_defaultRegistry) return _defaultRegistry;
  _defaultRegistry = new EmbeddingRegistry();
  _defaultRegistry.register({
    id: 'hash-fallback',
    envVars: [],
    priority: 999,
    factory: () => new HashFallbackProvider(),
  });
  return _defaultRegistry;
}

export function setDefaultRegistry(reg: EmbeddingRegistry): void {
  _defaultRegistry = reg;
}

export class FilePilReader implements PilReader {
  private readonly registry: EmbeddingRegistry;

  constructor(private readonly cwd: string, registry?: EmbeddingRegistry) {
    this.registry = registry ?? getDefaultRegistry();
  }

  hasManifest(): boolean {
    return existsSync(join(this.cwd, MANIFEST_FILE));
  }

  readManifest(): Record<string, unknown> | null {
    if (!this.hasManifest()) return null;
    try {
      return JSON.parse(readFileSync(join(this.cwd, MANIFEST_FILE), 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async loadVectorIndex(): Promise<VectorIndex> {
    const manifest = this.readManifest();
    const dim = typeof manifest?.['embeddings'] === 'object' && manifest?.['embeddings']
      ? Number((manifest['embeddings'] as Record<string, unknown>)['dim'] ?? 384)
      : 384;
    const idx = new FlatVectorIndex(dim);
    const vecPath = join(this.cwd, VECTORS_FILE);
    if (existsSync(vecPath)) {
      try {
        await idx.load(vecPath);
      } catch {
        // corrupted index → empty
      }
    }
    return idx;
  }

  async embed(text: string): Promise<Float32Array> {
    const provider: EmbeddingProvider = this.registry.resolve();
    const vecs = await provider.embedBatch([text]);
    return vecs[0] ?? new Float32Array(provider.dim);
  }
}

export interface SearchResult {
  file: string;
  startLine: number;
  score: number;
  preview: string;
}

export interface SearchResponse {
  results: SearchResult[];
  meta: {
    mode: 'hybrid' | 'vector' | 'bm25';
    estTokens: number;
    pilVersion: number;
    indexedAt: string;
    confidence: 'high' | 'medium' | 'stale';
    traceId: string;
  };
  note?: string;
}

export async function pilSearch(
  reader: PilReader,
  queryText: string,
  topK: number,
  traceId: string,
): Promise<SearchResponse> {
  if (!reader.hasManifest()) {
    return {
      results: [],
      meta: { mode: 'hybrid', estTokens: 0, pilVersion: 0, indexedAt: '', confidence: 'stale', traceId },
      note: 'No PIL found. Run `aion sync` to build the index.',
    };
  }
  const manifest = reader.readManifest() as Record<string, unknown> | null;
  const idx = await reader.loadVectorIndex();
  const embeddings = (manifest?.['embeddings'] ?? {}) as Record<string, unknown>;
  const dim = Number(embeddings['dim'] ?? 384);
  const indexedAt = typeof manifest?.['generatedAt'] === 'string' ? manifest['generatedAt'] as string : new Date().toISOString();
  const engine: RagEngine = {
    manifest: () => ({
      schemaVersion: 2,
      generatedAt: indexedAt,
      root: '.',
      repoHash: '',
      fileCount: 0,
      chunkCount: 0,
      embeddings: { providerId: String(embeddings['providerId'] ?? 'hash-fallback'), modelId: String(embeddings['modelId'] ?? 'hash-384'), dim, indexType: 'flat', vectorsPath: 'pil/vectors.bin', count: idx.size(), norm: 'l2' as const },
    }),
    vectorIndex: () => idx,
    bm25: () => null,
    embed: (text) => reader.embed(text),
  };

  const ragResult: RagQueryResult = await query(engine, { text: queryText, topK, mode: 'hybrid' }, traceId);

  return {
    results: ragResult.hits.map((h) => ({
      file: h.id.split(':')[0] ?? h.id,
      startLine: Number(h.id.split(':')[1] ?? 0) || 0,
      score: h.score,
      preview: '',
    })),
    meta: {
      mode: 'hybrid',
      estTokens: ragResult.meta.estTokens,
      pilVersion: ragResult.meta.pilVersion,
      indexedAt: ragResult.meta.indexedAt,
      confidence: ragResult.meta.confidence,
      traceId: ragResult.meta.traceId,
    },
  };
}

export function initPilLayout(cwd: string): void {
  mkdirSync(join(cwd, 'pil'), { recursive: true });
}

export function resetPil(cwd: string): void {
  const pilDir = join(cwd, 'pil');
  if (existsSync(pilDir)) {
    rmSync(pilDir, { recursive: true, force: true });
  }
}