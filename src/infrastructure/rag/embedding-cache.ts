import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EmbeddingProvider } from './embeddings/registry.js';

interface CacheFile {
  providerId: string;
  model: string;
  dim: number;
  entries: Record<string, number[]>;
}

function textHash(providerId: string, model: string, text: string): string {
  return createHash('sha1').update(`${providerId}|${model}|${text}`).digest('hex').slice(0, 24);
}

export class EmbeddingCache {
  private readonly cachePath: string;
  private entries: Map<string, number[]>;
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly cwd: string,
    private readonly provider: EmbeddingProvider,
  ) {
    this.cachePath = join(cwd, '.ai-runtime', 'pil', 'embed-cache.json');
    this.entries = new Map();
    this.load();
  }

  private load(): void {
    if (!existsSync(this.cachePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.cachePath, 'utf8')) as CacheFile;
      if (raw.providerId !== this.provider.id || raw.model !== this.provider.model || raw.dim !== this.provider.dim) return;
      for (const [k, v] of Object.entries(raw.entries)) {
        this.entries.set(k, v);
      }
    } catch { /* corrupt cache → ignore */ }
  }

  private save(): void {
    const payload: CacheFile = {
      providerId: this.provider.id,
      model: this.provider.model,
      dim: this.provider.dim,
      entries: Object.fromEntries(this.entries),
    };
    mkdirSync(join(this.cwd, '.ai-runtime', 'pil'), { recursive: true });
    writeFileSync(this.cachePath, JSON.stringify(payload), 'utf8');
  }

  async embedBatch(texts: readonly string[]): Promise<Float32Array[]> {
    const result: Float32Array[] = new Array(texts.length);
    const toFetch: { idx: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]!;
      const key = textHash(this.provider.id, this.provider.model, text);
      const cached = this.entries.get(key);
      if (cached) {
        result[i] = new Float32Array(cached);
        this.hits++;
      } else {
        toFetch.push({ idx: i, text });
        this.misses++;
      }
    }

    if (toFetch.length > 0) {
      const fetched = await this.provider.embedBatch(toFetch.map((t) => t.text));
      for (let i = 0; i < toFetch.length; i++) {
        const { idx } = toFetch[i]!;
        const vec = fetched[i]!;
        result[idx] = vec;
        const key = textHash(this.provider.id, this.provider.model, toFetch[i]!.text);
        this.entries.set(key, Array.from(vec));
      }
      this.save();
    }

    return result;
  }

  stats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.entries.size,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  clear(): void {
    this.entries.clear();
    this.save();
  }
}