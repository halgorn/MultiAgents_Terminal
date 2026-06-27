export interface QueryExpander {
  (query: string): Promise<string[]>;
}

export interface MultiQueryOptions {
  provider: (prompt: string, systemPrompt?: string) => Promise<string>;
  numVariants?: number;
  systemPrompt?: string;
}

export function createMultiQueryExpander(opts: MultiQueryOptions): QueryExpander {
  const numVariants = opts.numVariants ?? 3;
  const systemPrompt = opts.systemPrompt ?? 'You are a code search assistant. Given a user query, generate alternative phrasings that capture the same intent. Output ONLY a JSON array of strings, no prose, no markdown.';

  return async (query: string): Promise<string[]> => {
    const prompt = [
      `Query: "${query}"`,
      '',
      `Generate ${numVariants} alternative phrasings (reformulations, synonyms, related terms). Return a JSON array of strings.`,
      'Example: ["reformulation 1", "reformulation 2", "reformulation 3"]',
    ].join('\n');

    let raw: string;
    try {
      raw = await opts.provider(prompt, systemPrompt);
    } catch {
      return [query];
    }

    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) return [query];

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [query];
    }

    if (!Array.isArray(parsed)) return [query];
    const variants = parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
    return [query, ...variants].slice(0, numVariants + 1);
  };
}

export function createHydeExpander(opts: MultiQueryOptions): QueryExpander {
  const systemPrompt = opts.systemPrompt ?? 'You are a code understanding assistant. Given a query, write a hypothetical code snippet or explanation (50-150 words) that would answer it. This will be used to improve semantic search. Output ONLY the hypothetical text, no preamble.';

  return async (query: string): Promise<string[]> => {
    const prompt = [
      `Query: "${query}"`,
      '',
      'Write a hypothetical code snippet or explanation that would answer this query.',
    ].join('\n');

    let raw: string;
    try {
      raw = await opts.provider(prompt, systemPrompt);
    } catch {
      return [query];
    }

    const trimmed = raw.trim();
    if (!trimmed) return [query];
    return [query, trimmed];
  };
}

export function createCombinedExpander(expanders: readonly QueryExpander[]): QueryExpander {
  return async (query: string): Promise<string[]> => {
    const allVariants = new Set<string>([query]);
    for (const expander of expanders) {
      try {
        const variants = await expander(query);
        for (const v of variants) allVariants.add(v);
      } catch {
        // individual expander failure → continue with what we have
      }
    }
    return Array.from(allVariants);
  };
}