import { z } from 'zod';

export const EvidenceReportSchema = z.object({
  reproduced: z.boolean(),
  confidence: z.number().min(0).max(100),
  logs: z.array(z.string()).default([]),
  stackTrace: z.string().nullish(),
  files: z
    .array(
      z.object({
        path: z.string(),
        line: z.number().int().nonnegative(),
        snippet: z.string(),
      }),
    )
    .default([]),
  rootCause: z.string().nullish(),
  summary: z.string().min(1),
});

export type EvidenceReport = z.infer<typeof EvidenceReportSchema>;
