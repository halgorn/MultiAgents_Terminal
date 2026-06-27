import { z } from 'zod';

export const PilManifestSchema = z.object({
  schemaVersion: z.literal(2),
  generatedAt: z.string().datetime(),
  root: z.string(),
  repoHash: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  embeddings: z.object({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    dim: z.number().int().positive(),
    indexType: z.enum(['flat', 'ivf', 'hnsw']),
    vectorsPath: z.string().min(1),
    count: z.number().int().nonnegative(),
    norm: z.enum(['l2', 'none']).default('l2'),
  }),
  bm25: z.object({
    terms: z.number().int().nonnegative(),
    docs: z.number().int().nonnegative(),
    path: z.string().min(1),
  }).optional(),
  chunker: z.object({
    parser: z.string().min(1),
    version: z.string().min(1),
  }).optional(),
  languageProfile: z.enum(['typescript', 'python', 'go', 'rust', 'mixed']).optional(),
});

export type PilManifest = z.infer<typeof PilManifestSchema>;

export const PIL_V1_LEGACY_KEYS = [
  'schemaVersion',
  'generatedAt',
  'root',
  'repoHash',
  'files',
  'symbols',
  'imports',
  'chunks',
  'tests',
  'stats',
  'embeddings',
  'deps',
] as const;