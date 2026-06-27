import type { LlmRerankFn, LlmRerankHit } from './query.js';

export interface LlmRerankOptions {
  provider: (prompt: string, systemPrompt?: string) => Promise<string>;
  systemPrompt?: string;
  topN?: number;
}

export function createLlmReranker(opts: LlmRerankOptions): LlmRerankFn {
  const systemPrompt = opts.systemPrompt ?? 'You are a code-search reranker. Given a query and a list of code chunks (id + brief), return the ids in order of relevance, most relevant first. Output ONLY a JSON array of strings, no prose, no markdown.';
  const topN = opts.topN ?? 20;

  return async (query: string, candidates: LlmRerankHit[]): Promise<string[]> => {
    if (candidates.length === 0) return [];
    const trimmed = candidates.slice(0, topN);
    const prompt = [
      `Query: ${query}`,
      '',
      'Candidates (id:score):',
      ...trimmed.map((c, i) => `${i + 1}. ${c.id} (score: ${c.score.toFixed(4)})`),
      '',
      'Return a JSON array of the candidate ids in order of relevance (most relevant first). All ids must appear exactly once.',
    ].join('\n');

    let raw: string;
    try {
      raw = await opts.provider(prompt, systemPrompt);
    } catch {
      return candidates.map((c) => c.id);
    }

    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) return candidates.map((c) => c.id);

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return candidates.map((c) => c.id);
    }

    if (!Array.isArray(parsed)) return candidates.map((c) => c.id);
    return parsed.filter((x): x is string => typeof x === 'string');
  };
}

export function createNoopReranker(): LlmRerankFn {
  return async (_query, candidates) => candidates.map((c) => c.id);
}