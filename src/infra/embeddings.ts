import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const VECTOR_DIMENSIONS = 384;

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function embedText(text: string, maxChars: number): Float32Array {
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

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

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
    const cached = this.loadCache(category, filename);
    if (cached && cached.mtime === mtime) {
      return new Float32Array(cached.vector);
    }

    const vector = Array.from(embedText(text, 2000));
    this.saveCache(category, filename, { vector, mtime, text: text.slice(0, 500) });
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
    const queryVec = embedText(queryText, 500);

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
