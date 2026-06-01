import { z } from 'zod';

export const ReviewFindingSchema = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  file: z.string(),
  line: z.number().int().positive().nullish(),
  description: z.string(),
  suggestion: z.string().nullish(),
});

export const ReviewReportSchema = z.object({
  approved: z.boolean(),
  findings: z.array(ReviewFindingSchema).default([]),
  regressionRisk: z.enum(['none', 'low', 'medium', 'high']),
  summary: z.string(),
  blockers: z.array(z.string()).default([]),
});

export type ReviewReport = z.infer<typeof ReviewReportSchema>;
