import { BM25IndexLike } from './query.js';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in',
  'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were', 'will', 'with',
  'this', 'but', 'or', 'not', 'have', 'had', 'do', 'does', 'did', 'been',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export interface BM25Config {
  k1: number;
  b: number;
}

const DEFAULT_CONFIG: BM25Config = { k1: 1.2, b: 0.75 };

export interface BM25Doc {
  id: string;
  text: string;
}

export class InMemoryBM25Index implements BM25IndexLike {
  private readonly config: BM25Config;
  private readonly postings = new Map<string, Map<string, number>>();
  private readonly docLengths = new Map<string, number>();
  private readonly docTokens = new Map<string, string[]>();
  private totalLength = 0;
  private avgDl = 0;

  constructor(config: Partial<BM25Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  addBatch(docs: readonly BM25Doc[]): void {
    for (const doc of docs) {
      this.add(doc.id, doc.text);
    }
  }

  add(id: string, text: string): void {
    if (this.docTokens.has(id)) return;
    const tokens = tokenize(text);
    if (tokens.length === 0) return;
    this.docTokens.set(id, tokens);
    this.docLengths.set(id, tokens.length);
    this.totalLength += tokens.length;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, freq] of tf) {
      let p = this.postings.get(term);
      if (!p) { p = new Map(); this.postings.set(term, p); }
      p.set(id, freq);
    }
    this.avgDl = this.totalLength / this.docLengths.size;
  }

  size(): number {
    return this.docLengths.size;
  }

  search(text: string, k: number): Array<{ id: string; score: number }> {
    const queryTerms = tokenize(text);
    if (queryTerms.length === 0) return [];
    const scores = new Map<string, number>();
    const N = this.docLengths.size;
    for (const term of queryTerms) {
      const p = this.postings.get(term);
      if (!p) continue;
      const df = p.size;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const [docId, tf] of p) {
        const dl = this.docLengths.get(docId) ?? 1;
        const norm = 1 - this.config.b + this.config.b * (dl / (this.avgDl || 1));
        const s = idf * ((tf * (this.config.k1 + 1)) / (tf + this.config.k1 * norm));
        scores.set(docId, (scores.get(docId) ?? 0) + s);
      }
    }
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(0, k))
      .map(([id, score]) => ({ id, score }));
  }

  toJSON(): { docs: BM25Doc[] } {
    return {
      docs: Array.from(this.docTokens.entries()).map(([id, tokens]) => ({
        id,
        text: tokens.join(' '),
      })),
    };
  }

  static fromJSON(data: { docs: BM25Doc[] }, config?: Partial<BM25Config>): InMemoryBM25Index {
    const idx = new InMemoryBM25Index(config);
    for (const doc of data.docs) {
      const originalText = doc.text;
      idx.add(doc.id, originalText);
    }
    return idx;
  }
}