import type { PilManifest } from './manifest.js';
import type { VectorIndex, ScoredId } from './vectors/index.js';

export interface RagHit {
  id: string;
  score: number;
  bm25Score: number;
  vectorScore: number;
  fusedScore: number;
}

export interface RagQueryOptions {
  text: string;
  topK?: number;
  mode?: 'hybrid' | 'vector' | 'bm25';
  filters?: { filePrefix?: string; language?: string; minTokens?: number };
  reranker?: 'none' | 'llm';
}

export interface RagQueryResult {
  hits: RagHit[];
  meta: {
    pilVersion: number;
    indexedAt: string;
    confidence: 'high' | 'medium' | 'stale';
    estTokens: number;
    traceId: string;
    mode: RagQueryOptions['mode'];
  };
}

export interface BM25IndexLike {
  search(text: string, k: number): Array<{ id: string; score: number }>;
}

export interface RagEngine {
  manifest(): PilManifest;
  vectorIndex(): VectorIndex;
  bm25(): BM25IndexLike | null;
  embed(text: string): Promise<Float32Array>;
}

export async function query(engine: RagEngine, q: RagQueryOptions, traceId = 'rag'): Promise<RagQueryResult> {
  const mode = q.mode ?? 'hybrid';
  const topK = Math.max(1, q.topK ?? 10);
  const expandedK = Math.max(topK * 4, 40);

  let bm25Hits: Array<{ id: string; score: number }> = [];
  let vectorHits: ScoredId[] = [];

  if (mode !== 'vector') {
    const bm = engine.bm25();
    if (bm) bm25Hits = bm.search(q.text, expandedK);
  }

  if (mode !== 'bm25') {
    const queryVec = await engine.embed(q.text);
    vectorHits = engine.vectorIndex().search(queryVec, expandedK);
  }

  const fused = reciprocalRankFusion(bm25Hits, vectorHits);
  const top = fused.slice(0, topK);

  const estTokens = top.length * 50;
  const manifest = engine.manifest();

  return {
    hits: top.map((h) => ({
      id: h.id,
      score: h.fusedScore,
      bm25Score: h.bm25Score,
      vectorScore: h.vectorScore,
      fusedScore: h.fusedScore,
    })),
    meta: {
      pilVersion: manifest.schemaVersion,
      indexedAt: manifest.generatedAt,
      confidence: 'high',
      estTokens,
      traceId,
      mode,
    },
  };
}

export function reciprocalRankFusion(
  bm25Hits: Array<{ id: string; score: number }>,
  vectorHits: Array<{ id: string; score: number }>,
  k = 60,
): Array<{ id: string; bm25Score: number; vectorScore: number; fusedScore: number }> {
  const scores = new Map<string, { bm25Score: number; vectorScore: number; fusedScore: number }>();

  bm25Hits.forEach((h, i) => {
    const entry = scores.get(h.id) ?? { bm25Score: 0, vectorScore: 0, fusedScore: 0 };
    entry.bm25Score = h.score;
    entry.fusedScore += 1 / (k + i + 1);
    scores.set(h.id, entry);
  });

  vectorHits.forEach((h, i) => {
    const entry = scores.get(h.id) ?? { bm25Score: 0, vectorScore: 0, fusedScore: 0 };
    entry.vectorScore = h.score;
    entry.fusedScore += 1 / (k + i + 1);
    scores.set(h.id, entry);
  });

  return Array.from(scores.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.fusedScore - a.fusedScore);
}