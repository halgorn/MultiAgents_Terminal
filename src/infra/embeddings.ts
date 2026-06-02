import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// Lazy-load to avoid startup cost when embeddings aren't used
type ExtractorFn = (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;
let _pipeline: ExtractorFn | null = null;

async function getPipeline(): Promise<ExtractorFn> {
  if (_pipeline) return _pipeline;
  const { pipeline } = await import('@xenova/transformers');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _pipeline = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true })) as any;
  return _pipeline!;
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

    const embed = await getPipeline();
    const output = await embed(text.slice(0, 2000), { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data);
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
    const embed = await getPipeline();
    const queryOutput = await embed(queryText.slice(0, 500), { pooling: 'mean', normalize: true });
    const queryVec = new Float32Array(queryOutput.data);

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
