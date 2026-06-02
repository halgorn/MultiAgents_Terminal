/**
 * Minimal BM25 implementation — no external deps.
 * Used for exact-term retrieval (symbol names, file paths, error messages)
 * combined with vector similarity for hybrid search.
 */

const K1 = 1.5; // term frequency saturation
const B = 0.75; // length normalization

interface BM25Doc {
  id: string;
  terms: Map<string, number>; // term → frequency
  length: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1);
}

export class BM25Index {
  private docs: BM25Doc[] = [];
  private df: Map<string, number> = new Map(); // document frequency per term
  private avgLen = 0;

  add(id: string, text: string): void {
    const tokens = tokenize(text);
    const freq = new Map<string, number>();
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

    // Update document frequencies
    for (const term of freq.keys()) {
      this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }

    this.docs.push({ id, terms: freq, length: tokens.length });
    this.avgLen = this.docs.reduce((s, d) => s + d.length, 0) / this.docs.length;
  }

  score(query: string): Array<{ id: string; score: number }> {
    const qTerms = tokenize(query);
    const N = this.docs.length;
    if (N === 0) return [];

    const scores = this.docs.map((doc) => {
      let score = 0;
      for (const term of qTerms) {
        const tf = doc.terms.get(term) ?? 0;
        if (tf === 0) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        const norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (doc.length / this.avgLen)));
        score += idf * norm;
      }
      return { id: doc.id, score };
    });

    return scores.sort((a, b) => b.score - a.score);
  }
}

/**
 * Hybrid score: combine BM25 (exact) + cosine (semantic).
 * alpha controls the blend: 0 = pure BM25, 1 = pure vector.
 */
export function hybridScore(
  bm25Scores: Array<{ id: string; score: number }>,
  vectorScores: Array<{ id: string; score: number }>,
  alpha = 0.5,
): Array<{ id: string; score: number }> {
  // Normalize BM25 to [0,1]
  const maxBm25 = bm25Scores[0]?.score ?? 1;
  const bm25Map = new Map(bm25Scores.map((s) => [s.id, s.score / (maxBm25 || 1)]));
  const vecMap = new Map(vectorScores.map((s) => [s.id, s.score]));

  const ids = new Set([...bm25Map.keys(), ...vecMap.keys()]);
  const combined: Array<{ id: string; score: number }> = [];

  for (const id of ids) {
    const bm = bm25Map.get(id) ?? 0;
    const vec = vecMap.get(id) ?? 0;
    combined.push({ id, score: (1 - alpha) * bm + alpha * vec });
  }

  return combined.sort((a, b) => b.score - a.score);
}
