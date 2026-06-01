import { z } from 'zod';

export const PatchReportSchema = z.object({
  filesChanged: z.array(z.string()).min(1),
  diff: z.string().min(1),
  buildCommand: z.string(),
  testCommand: z.string(),
  description: z.string(),
  risksIntroduced: z.array(z.string()),
});

export type PatchReport = z.infer<typeof PatchReportSchema>;
