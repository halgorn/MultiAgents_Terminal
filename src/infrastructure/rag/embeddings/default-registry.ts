import { EmbeddingRegistry } from './registry.js';
import { HashFallbackProvider } from './registry.js';
import {
  VoyageCode3Provider,
  OpenAITextEmbedding3SmallProvider,
  CohereEmbedV3Provider,
} from './providers.js';

export function createDefaultRegistry(): EmbeddingRegistry {
  const reg = new EmbeddingRegistry();
  reg.register({ id: 'voyage-code-3', envVars: ['VOYAGE_API_KEY'], priority: 1, factory: () => new VoyageCode3Provider() });
  reg.register({ id: 'openai-text-embedding-3-small', envVars: ['OPENAI_API_KEY'], priority: 2, factory: () => new OpenAITextEmbedding3SmallProvider() });
  reg.register({ id: 'cohere-embed-v3', envVars: ['COHERE_API_KEY'], priority: 3, factory: () => new CohereEmbedV3Provider() });
  reg.register({ id: 'hash-fallback', envVars: [], priority: 999, factory: () => new HashFallbackProvider() });
  return reg;
}