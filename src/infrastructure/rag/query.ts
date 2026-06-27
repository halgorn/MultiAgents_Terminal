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
  filters?: { filePrefix?: string; fileSuffix?: string; language?: string; minScore?: number };
  reranker?: 'none' | 'llm';
  rerankerTopK?: number;
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
    candidatesBeforeRerank?: number;
    rerankerUsed?: 'none' | 'llm';
    filtersApplied?: number;
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
  fileMetadata?(id: string): { language?: string; loc?: number; isTest?: boolean } | null;
}

export function applyFilters(hits: RagHit[], filters: RagQueryOptions['filters']): RagHit[] {
  if (!filters) return hits;
  return hits.filter((h) => {
    if (filters.filePrefix && !h.id.startsWith(filters.filePrefix)) return false;
    if (filters.fileSuffix && !h.id.endsWith(filters.fileSuffix)) return false;
    if (filters.minScore !== undefined && h.score < filters.minScore) return false;
    return true;
  });
}

export interface LlmRerankHit {
  id: string;
  score: number;
}

export interface LlmRerankFn {
  (query: string, candidates: LlmRerankHit[]): Promise<string[]>;
}

export async function query(
  engine: RagEngine,
  q: RagQueryOptions,
  traceId = 'rag',
  reranker?: LlmRerankFn,
): Promise<RagQueryResult> {
  const mode = q.mode ?? 'hybrid';
  const topK = Math.max(1, q.topK ?? 10);
  const expandedK = Math.max(topK * 6, 60);

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

  let fused: RagHit[] = reciprocalRankFusion(bm25Hits, vectorHits).map((h) => ({
    id: h.id,
    score: h.fusedScore,
    bm25Score: h.bm25Score,
    vectorScore: h.vectorScore,
    fusedScore: h.fusedScore,
  }));

  const filtersApplied = q.filters ? fused.length : 0;
  fused = applyFilters(fused, q.filters);

  let rerankerUsed: 'none' | 'llm' = 'none';
  const candidatesBeforeRerank = fused.length;
  if (q.reranker === 'llm' && reranker && fused.length > topK) {
    const rerankInput: LlmRerankHit[] = fused.slice(0, q.rerankerTopK ?? Math.max(topK * 3, 30))
      .map((h) => ({ id: h.id, score: h.fusedScore }));
    try {
      const rerankedIds = await reranker(q.text, rerankInput);
      const rerankedSet = new Set(rerankedIds);
      const preserved = fused.filter((h) => !rerankedSet.has(h.id));
      const rerankedHits = rerankedIds
        .map((id) => fused.find((h) => h.id === id))
        .filter((h): h is NonNullable<typeof h> => h !== undefined);
      fused = [...rerankedHits, ...preserved];
      rerankerUsed = 'llm';
    } catch {
      // reranker failure → fall back to RRF order
    }
  }

  const top = fused.slice(0, topK);

  const estTokens = top.length * 50;
  const manifest = engine.manifest();

  return {
    hits: top.map((h) => ({
      id: h.id,
      score: h.score,
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
      candidatesBeforeRerank: rerankerUsed === 'llm' ? candidatesBeforeRerank : undefined,
      rerankerUsed,
      filtersApplied: filtersApplied > 0 ? filtersApplied : undefined,
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