import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const VECTOR_DIMENSIONS = 384;
const XENOVA_MODEL = 'Xenova/jina-embeddings-v2-base-code';

// Tri-state: undefined = not tried, null = failed, function = ready
let _xenovaPipeline: ((input: string, opts: object) => Promise<{ data: Float32Array; dims: number[] }>) | null | undefined = undefined;

async function getXenovaPipeline() {
  if (_xenovaPipeline !== undefined) return _xenovaPipeline;
  try {
    // Dynamic import keeps this optional — fails gracefully if package not installed
    const mod = await import('@xenova/transformers') as { pipeline: (task: string, model: string) => Promise<(input: string | string[], opts: object) => Promise<{ data: Float32Array; dims: number[] }>> };
    const pipe = await mod.pipeline('feature-extraction', XENOVA_MODEL);
    _xenovaPipeline = pipe;
    return _xenovaPipeline;
  } catch {
    _xenovaPipeline = null;
    return null;
  }
}

async function callXenova(texts: string[]): Promise<number[][] | null> {
  const pipe = await getXenovaPipeline();
  if (!pipe) return null;
  try {
    const results: number[][] = [];
    for (const text of texts) {
      const out = await pipe(text.slice(0, 8192), { pooling: 'mean', normalize: true });
      results.push(Array.from(out.data));
    }
    return results;
  } catch {
    return null;
  }
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Local hash-based embedding — deterministic, zero cost, not semantic
export function embedText(text: string, maxChars: number): Float32Array {
  const vector = new Float32Array(VECTOR_DIMENSIONS);
  const tokens = text
    .slice(0, maxChars)
    .toLowerCase()
    .match(/[a-z0-9_./:-]{2,}/g) ?? [];

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % VECTOR_DIMENSIONS;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign;
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  if (norm === 0) return vector;

  const scale = 1 / Math.sqrt(norm);
  for (let i = 0; i < vector.length; i++) vector[i] *= scale;
  return vector;
}

// ── Real Embedding API ────────────────────────────────────────────────────────

export function embeddingProvider(): string {
  if (process.env.VOYAGE_API_KEY) return 'voyage-code-3';
  if (process.env.OPENAI_API_KEY) return 'text-embedding-3-small';
  if (_xenovaPipeline === null) return 'hash-384d'; // xenova failed to load
  return 'jina-code-768d'; // xenova intended or loaded
}

// Single text — returns null if no API key configured
export async function embedTextRemote(text: string): Promise<number[] | null> {
  const batch = await embedBatch([text]);
  return batch[0] ?? null;
}

// Batch embed — Voyage → OpenAI → Xenova/jina-code → FNV-1a hash
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (process.env.VOYAGE_API_KEY) return callVoyage(texts);
  if (process.env.OPENAI_API_KEY) return callOpenAI(texts);
  const xenova = await callXenova(texts);
  if (xenova) return xenova;
  return texts.map((t) => Array.from(embedText(t, 2000)));
}

async function callVoyage(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  // Voyage accepts up to 128 inputs per request
  for (let i = 0; i < texts.length; i += 128) {
    const batch = texts.slice(i, i + 128);
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
      body: JSON.stringify({ input: batch, model: 'voyage-code-3' }),
    });
    if (!res.ok) throw new Error(`Voyage API ${res.status}: ${await res.text()}`);
    const json = await res.json() as { data: Array<{ embedding: number[] }> };
    results.push(...json.data.map((d) => d.embedding));
  }
  return results;
}

async function callOpenAI(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  // OpenAI accepts up to 100 inputs per request
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ input: batch, model: 'text-embedding-3-small' }),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
    const json = await res.json() as { data: Array<{ embedding: number[] }> };
    results.push(...json.data.map((d) => d.embedding));
  }
  return results;
}

// ── Similarity ────────────────────────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── EmbeddingStore (.ai-memory/ index) ───────────────────────────────────────

export interface EmbeddedEntry {
  category: string;
  filename: string;
  text: string;
  score: number;
}

interface EmbeddingCache {
  vector: number[];
  mtime: number;
  text: string;
  provider?: string; // invalidate if provider changes
}

export class EmbeddingStore {
  private readonly indexDir: string;

  constructor(private readonly knowledgeRoot: string) {
    this.indexDir = join(knowledgeRoot, '.embeddings');
  }

  private cacheFile(category: string, filename: string): string {
    const dir = join(this.indexDir, category);
    mkdirSync(dir, { recursive: true });
    return join(dir, `${filename}.json`);
  }

  private loadCache(category: string, filename: string): EmbeddingCache | null {
    try {
      return JSON.parse(readFileSync(this.cacheFile(category, filename), 'utf8')) as EmbeddingCache;
    } catch {
      return null;
    }
  }

  private saveCache(category: string, filename: string, cache: EmbeddingCache): void {
    writeFileSync(this.cacheFile(category, filename), JSON.stringify(cache), 'utf8');
  }

  async embedFile(category: string, filename: string, text: string, mtime: number): Promise<Float32Array> {
    const provider = embeddingProvider();
    const cached = this.loadCache(category, filename);
    // Cache hit: same mtime AND same provider (dimension may differ between providers)
    if (cached && cached.mtime === mtime && cached.provider === provider) {
      return new Float32Array(cached.vector);
    }

    let vector: number[];
    const remote = await embedTextRemote(text.slice(0, 4000));
    if (remote) {
      vector = remote;
    } else {
      vector = Array.from(embedText(text, 2000));
    }

    this.saveCache(category, filename, { vector, mtime, text: text.slice(0, 500), provider });
    return new Float32Array(vector);
  }

  async buildIndex(categories: string[]): Promise<number> {
    let count = 0;
    for (const category of categories) {
      const dir = join(this.knowledgeRoot, category);
      if (!existsSync(dir)) continue;

      const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
      for (const filename of files) {
        const filepath = join(dir, filename);
        const text = readFileSync(filepath, 'utf8');
        const { statSync } = await import('fs');
        const mtime = statSync(filepath).mtimeMs;
        await this.embedFile(category, filename, text, mtime);
        count++;
      }
    }
    return count;
  }

  hasIndex(): boolean {
    return existsSync(this.indexDir);
  }

  async query(queryText: string, topK = 5): Promise<EmbeddedEntry[]> {
    const remote = await embedTextRemote(queryText);
    const queryVec = remote ? new Float32Array(remote) : embedText(queryText, 500);

    const results: EmbeddedEntry[] = [];

    if (!existsSync(this.indexDir)) return results;

    for (const category of readdirSync(this.indexDir)) {
      const catDir = join(this.indexDir, category);
      if (!existsSync(catDir)) continue;

      for (const cacheFile of readdirSync(catDir).filter((f) => f.endsWith('.json'))) {
        try {
          const cache = JSON.parse(
            readFileSync(join(catDir, cacheFile), 'utf8'),
          ) as EmbeddingCache;
          const vec = new Float32Array(cache.vector);
          const score = cosineSimilarity(queryVec, vec);
          results.push({
            category,
            filename: cacheFile.replace(/\.json$/, ''),
            text: cache.text,
            score,
          });
        } catch { /* skip corrupted cache */ }
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

// ── Deterministic UUID from string (for vector store IDs) ────────────────────

export function stringToUUID(str: string): string {
  const h = createHash('sha256').update(str).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
