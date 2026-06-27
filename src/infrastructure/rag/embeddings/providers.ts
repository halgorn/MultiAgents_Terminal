import type { EmbeddingProvider } from './registry.js';

interface VoyageResponse {
  data: Array<{ embedding: number[] }>;
}

export class VoyageCode3Provider implements EmbeddingProvider {
  readonly id = 'voyage-code-3';
  readonly model = 'voyage-code-3';
  readonly dim = 1024;

  isConfigured(): boolean {
    return !!process.env['VOYAGE_API_KEY'];
  }

  async embedBatch(texts: readonly string[]): Promise<Float32Array[]> {
    const apiKey = process.env['VOYAGE_API_KEY'];
    if (!apiKey) throw new Error('VoyageCode3Provider: VOYAGE_API_KEY not set');

    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts as string[] }),
    });

    if (!res.ok) {
      throw new Error(`Voyage API ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as VoyageResponse;
    return data.data.map((d) => Float32Array.from(d.embedding));
  }
}

interface OpenAIResponse {
  data: Array<{ embedding: number[] }>;
}

export class OpenAITextEmbedding3SmallProvider implements EmbeddingProvider {
  readonly id = 'openai-text-embedding-3-small';
  readonly model = 'text-embedding-3-small';
  readonly dim = 1536;

  isConfigured(): boolean {
    return !!process.env['OPENAI_API_KEY'];
  }

  async embedBatch(texts: readonly string[]): Promise<Float32Array[]> {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OpenAITextEmbedding3SmallProvider: OPENAI_API_KEY not set');

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts as string[] }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as OpenAIResponse;
    return data.data.map((d) => Float32Array.from(d.embedding));
  }
}

interface CohereResponse {
  embeddings: Array<number[] | number[][]>;
}

export class CohereEmbedV3Provider implements EmbeddingProvider {
  readonly id = 'cohere-embed-v3';
  readonly model = 'embed-english-v3.0';
  readonly dim = 1024;

  isConfigured(): boolean {
    return !!process.env['COHERE_API_KEY'];
  }

  async embedBatch(texts: readonly string[]): Promise<Float32Array[]> {
    const apiKey = process.env['COHERE_API_KEY'];
    if (!apiKey) throw new Error('CohereEmbedV3Provider: COHERE_API_KEY not set');

    const res = await fetch('https://api.cohere.com/v1/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        texts: texts as string[],
        input_type: 'search_document',
      }),
    });

    if (!res.ok) {
      throw new Error(`Cohere API ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as CohereResponse;
    return data.embeddings.map((e) => {
      const arr = Array.isArray(e[0]) ? (e as number[][]).flat() : (e as number[]);
      return Float32Array.from(arr);
    });
  }
}

export function createDefaultProviders(): EmbeddingProvider[] {
  return [
    new VoyageCode3Provider(),
    new OpenAITextEmbedding3SmallProvider(),
    new CohereEmbedV3Provider(),
  ];
}