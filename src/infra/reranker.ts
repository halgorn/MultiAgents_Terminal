import Anthropic from '@anthropic-ai/sdk';

export interface RerankCandidate {
  id: string;
  content: string;
}

export interface RerankResult {
  id: string;
  rank: number;
  reason?: string;
}

type AnthropicLike = Pick<Anthropic, 'messages'>;
let clientFactoryForTest: (() => AnthropicLike) | null = null;

export function setRerankerClientFactoryForTest(factory: (() => AnthropicLike) | null): void {
  clientFactoryForTest = factory;
}

/**
 * Re-rank candidates using Claude as a cross-encoder.
 * Retrieves top-20, re-ranks to top-K. Cost: ~500 tokens per call.
 * Falls back to original order if API unavailable.
 */
export async function rerankWithLLM(
  query: string,
  candidates: RerankCandidate[],
  topK = 5,
): Promise<RerankResult[]> {
  if (candidates.length <= 1) {
    return candidates.slice(0, topK).map((c, i) => ({ id: c.id, rank: i }));
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return candidates.slice(0, topK).map((c, i) => ({ id: c.id, rank: i }));
  }

  const numbered = candidates
    .slice(0, 20) // re-rank at most 20 candidates
    .map((c, i) => `[${i + 1}] ${c.content.slice(0, 300)}`)
    .join('\n\n');

  const prompt = `You are a code search relevance judge.

Query: "${query}"

Rank these code chunks from most to least relevant. Return ONLY a JSON array of numbers representing the ranking (1-indexed), most relevant first.
Example: [3, 1, 7, 2, 5] means chunk 3 is most relevant, then 1, then 7, etc.

Chunks:
${numbered}

JSON array (top ${topK} only):`;

  try {
    const client = clientFactoryForTest?.() ?? new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const match = /\[[\d,\s]+\]/.exec(text);
    if (!match) throw new Error('No JSON array in response');

    const ranks = JSON.parse(match[0]) as number[];
    return ranks
      .filter((r) => r >= 1 && r <= candidates.length)
      .slice(0, topK)
      .map((r, i) => ({ id: candidates[r - 1]!.id, rank: i }));
  } catch {
    // Fallback: return original order
    return candidates.slice(0, topK).map((c, i) => ({ id: c.id, rank: i }));
  }
}

/**
 * Lightweight re-rank using keyword overlap score — zero cost, no API.
 * Useful as fallback or for testing without spending tokens.
 */
export function rerankLocal(
  query: string,
  candidates: RerankCandidate[],
  topK = 5,
): RerankResult[] {
  const queryTerms = query.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [];

  const scored = candidates.map((c, i) => {
    const text = c.content.toLowerCase();
    const score = queryTerms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
    return { id: c.id, originalRank: i, score };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.originalRank - b.originalRank)
    .slice(0, topK)
    .map((r, i) => ({ id: r.id, rank: i }));
}
