import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { cosineSimilarity, stringToUUID } from './embeddings.js';

export interface VectorResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface VectorStore {
  upsert(id: string, vector: number[], payload: Record<string, unknown>): Promise<void>;
  search(vector: number[], topK: number): Promise<VectorResult[]>;
  clear(): Promise<void>;
  size(): number;
}

// ── JsonFileStore — zero-infra, backed by a single JSON file ─────────────────

interface JsonEntry {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export class JsonFileStore implements VectorStore {
  private entries: Array<{ id: string; vector: Float32Array; payload: Record<string, unknown> }> = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as JsonEntry[];
      this.entries = raw.map((e) => ({ id: e.id, vector: new Float32Array(e.vector), payload: e.payload }));
    } catch { /* fresh store */ }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const raw: JsonEntry[] = this.entries.map((e) => ({
      id: e.id, vector: Array.from(e.vector), payload: e.payload,
    }));
    writeFileSync(this.filePath, JSON.stringify(raw), 'utf8');
  }

  async upsert(id: string, vector: number[], payload: Record<string, unknown>): Promise<void> {
    const idx = this.entries.findIndex((e) => e.id === id);
    const entry = { id, vector: new Float32Array(vector), payload };
    if (idx >= 0) this.entries[idx] = entry;
    else this.entries.push(entry);
    this.save();
  }

  async search(queryVec: number[], topK: number): Promise<VectorResult[]> {
    const q = new Float32Array(queryVec);
    return this.entries
      .map((e) => ({ id: e.id, score: cosineSimilarity(q, e.vector), payload: e.payload }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async clear(): Promise<void> {
    this.entries = [];
    this.save();
  }

  size(): number { return this.entries.length; }
}

// ── QdrantStore — production-ready, requires Qdrant instance ─────────────────
// Start locally: docker run -p 6333:6333 qdrant/qdrant
// Or use Qdrant Cloud (free tier available at cloud.qdrant.io)

export class QdrantStore implements VectorStore {
  private _size = 0;
  private initialized = false;

  constructor(
    private readonly url: string,
    private readonly collection: string,
  ) {}

  private async ensureCollection(dimension: number): Promise<void> {
    if (this.initialized) return;
    // Check if collection exists
    const check = await fetch(`${this.url}/collections/${this.collection}`);
    if (check.ok) { this.initialized = true; return; }

    // Create collection with cosine distance
    const res = await fetch(`${this.url}/collections/${this.collection}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors: { size: dimension, distance: 'Cosine' } }),
    });
    if (!res.ok) throw new Error(`Qdrant create collection: ${res.status} ${await res.text()}`);
    this.initialized = true;
  }

  async upsert(id: string, vector: number[], payload: Record<string, unknown>): Promise<void> {
    await this.ensureCollection(vector.length);
    const res = await fetch(`${this.url}/collections/${this.collection}/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [{ id: stringToUUID(id), vector, payload: { ...payload, _id: id } }],
      }),
    });
    if (!res.ok) throw new Error(`Qdrant upsert: ${res.status} ${await res.text()}`);
    this._size++;
  }

  async search(vector: number[], topK: number): Promise<VectorResult[]> {
    await this.ensureCollection(vector.length);
    const res = await fetch(`${this.url}/collections/${this.collection}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vector, limit: topK, with_payload: true }),
    });
    if (!res.ok) throw new Error(`Qdrant search: ${res.status} ${await res.text()}`);
    const json = await res.json() as { result: Array<{ score: number; payload: Record<string, unknown> }> };
    return json.result.map((r) => ({
      id: String(r.payload['_id'] ?? ''),
      score: r.score,
      payload: r.payload,
    }));
  }

  async clear(): Promise<void> {
    await fetch(`${this.url}/collections/${this.collection}`, { method: 'DELETE' });
    this.initialized = false;
    this._size = 0;
  }

  size(): number { return this._size; }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createVectorStore(cwd: string): VectorStore {
  if (process.env.QDRANT_URL) {
    // Derive collection name from project path (last segment, safe chars)
    const projectSlug = cwd.split('/').filter(Boolean).pop()?.replace(/[^a-z0-9-]/gi, '-').toLowerCase() ?? 'project';
    return new QdrantStore(process.env.QDRANT_URL, `aion-${projectSlug}`);
  }
  return new JsonFileStore(join(cwd, '.ai-runtime', 'vectors.json'));
}

export function vectorStoreBackend(): string {
  return process.env.QDRANT_URL ? `Qdrant (${process.env.QDRANT_URL})` : 'JSON file (.ai-runtime/vectors.json)';
}
