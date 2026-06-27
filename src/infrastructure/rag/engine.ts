import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { PilManifestSchema, type PilManifest } from './manifest.js';
import { FlatVectorIndex, type VectorIndex } from './vectors/index.js';
import { InMemoryBM25Index, type BM25Doc } from './bm25.js';
import { EmbeddingCache } from './embedding-cache.js';
import { HashFallbackProvider, type EmbeddingProvider } from './embeddings/registry.js';
import type { BM25IndexLike, RagEngine } from './query.js';

const MANIFEST = '.ai-runtime/pil/manifest.json';
const VECTORS = '.ai-runtime/pil/vectors.bin';
const BM25_FILE = '.ai-runtime/pil/bm25.bin';
const META_FILE = '.ai-runtime/pil/chunk-meta.json';

export interface ChunkMeta {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  language?: string;
  loc?: number;
  isTest?: boolean;
}

export interface PilEngineOptions {
  embeddingProvider?: EmbeddingProvider;
  bm25?: InMemoryBM25Index;
  chunks?: ChunkMeta[];
}

export class PilEngine implements RagEngine {
  private readonly cwd: string;
  private readonly provider: EmbeddingProvider;
  private readonly cache: EmbeddingCache;
  private readonly bm25Index: InMemoryBM25Index;
  private readonly meta = new Map<string, ChunkMeta>();
  private readonly indexes = new Map<string, VectorIndex>();
  private readonly pendingVectors = new Map<string, Float32Array>();
  private manifestData: PilManifest | null = null;
  private ready: Promise<void> | null = null;

  constructor(cwd: string, opts: PilEngineOptions = {}) {
    this.cwd = cwd;
    this.provider = opts.embeddingProvider ?? new HashFallbackProvider();
    this.cache = new EmbeddingCache(cwd, this.provider);
    this.bm25Index = opts.bm25 ?? new InMemoryBM25Index();
    if (opts.chunks) {
      for (const c of opts.chunks) {
        this.meta.set(c.id, c);
        if (c.text) this.bm25Index.add(c.id, c.text);
      }
      this.ready = this.embedChunks(opts.chunks);
    }
  }

  private async embedChunks(chunks: readonly ChunkMeta[]): Promise<void> {
    const batchSize = 32;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const vecs = await this.cache.embedBatch(batch.map((c) => c.text));
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j]!;
        const v = vecs[j]!;
        if (v.length !== this.provider.dim) continue;
        this.ensureIndex(c.id, v);
      }
    }
  }

  async waitReady(): Promise<void> {
    if (this.ready) await this.ready;
  }

  static async load(cwd: string, opts: PilEngineOptions = {}): Promise<PilEngine> {
    const engine = new PilEngine(cwd, opts);
    await engine.loadFromDisk();
    return engine;
  }

  private async loadFromDisk(): Promise<void> {
    const manifestPath = join(this.cwd, MANIFEST);
    if (!existsSync(manifestPath)) return;
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
      this.manifestData = PilManifestSchema.parse(raw);
    } catch {
      return;
    }

    const vectorsPath = join(this.cwd, VECTORS);
    if (existsSync(vectorsPath)) {
      const idx = new FlatVectorIndex(this.manifestData.embeddings.dim);
      try {
        await idx.load(vectorsPath);
        this.indexes.set('default', idx);
      } catch { /* corrupted index */ }
    }

    const metaPath = join(this.cwd, META_FILE);
    if (existsSync(metaPath)) {
      try {
        const chunks = JSON.parse(readFileSync(metaPath, 'utf8')) as ChunkMeta[];
        for (const c of chunks) {
          this.meta.set(c.id, c);
          if (c.text) this.bm25Index.add(c.id, c.text);
        }
      } catch { /* corrupt meta */ }
    } else {
      this.loadBm25FromChunks();
    }
  }

  private loadBm25FromChunks(): void {
    for (const c of this.meta.values()) {
      if (c.text) this.bm25Index.add(c.id, c.text);
    }
  }

  addChunk(c: ChunkMeta, vector: Float32Array): void {
    this.meta.set(c.id, c);
    if (c.text) this.bm25Index.add(c.id, c.text);
    this.ensureIndex(c.id, vector);
  }

  private ensureIndex(id: string, vector: Float32Array): void {
    let idx = this.indexes.get('default');
    if (!idx) {
      idx = new FlatVectorIndex(vector.length);
      this.indexes.set('default', idx);
    }
    idx.insert(id, vector);
  }

  manifest(): PilManifest {
    if (this.manifestData) return this.manifestData;
    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      root: this.cwd,
      repoHash: '',
      fileCount: this.meta.size,
      chunkCount: this.meta.size,
      embeddings: {
        providerId: this.provider.id,
        modelId: this.provider.model,
        dim: this.provider.dim,
        indexType: 'flat',
        vectorsPath: 'pil/vectors.bin',
        count: this.indexes.get('default')?.size() ?? 0,
        norm: 'l2',
      },
    };
  }

  vectorIndex(): VectorIndex {
    const idx = this.indexes.get('default');
    if (!idx) return new FlatVectorIndex(this.provider.dim);
    return idx;
  }

  bm25(): BM25IndexLike {
    return this.bm25Index;
  }

  async embed(text: string): Promise<Float32Array> {
    const vecs = await this.cache.embedBatch([text]);
    return vecs[0] ?? new Float32Array(this.provider.dim);
  }

  fileMetadata(id: string): ChunkMeta | null {
    return this.meta.get(id) ?? null;
  }

  getMeta(id: string): ChunkMeta | null {
    return this.meta.get(id) ?? null;
  }

  cacheStats(): { hits: number; misses: number; size: number; hitRate: number } {
    return this.cache.stats();
  }

  async persist(): Promise<void> {
    const pilDir = join(this.cwd, '.ai-runtime', 'pil');
    mkdirSync(pilDir, { recursive: true });

    const idx = this.indexes.get('default');
    if (idx) await idx.persist(join(pilDir, 'vectors.bin'));

    const chunks: ChunkMeta[] = Array.from(this.meta.values());
    writeFileSync(join(pilDir, 'chunk-meta.json'), JSON.stringify(chunks), 'utf8');

    this.manifestData = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      root: this.cwd,
      repoHash: 'pil-engine',
      fileCount: new Set(chunks.map((c) => c.file)).size,
      chunkCount: chunks.length,
      embeddings: {
        providerId: this.provider.id,
        modelId: this.provider.model,
        dim: this.provider.dim,
        indexType: 'flat',
        vectorsPath: 'pil/vectors.bin',
        count: chunks.length,
        norm: 'l2',
      },
    };
    writeFileSync(join(pilDir, 'manifest.json'), JSON.stringify(this.manifestData, null, 2), 'utf8');
  }
}

export function bm25DocsFromChunks(chunks: readonly ChunkMeta[]): BM25Doc[] {
  return chunks.map((c) => ({ id: c.id, text: c.text }));
}