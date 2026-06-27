import { z } from 'zod';

export const QAResultSchema = z.object({
  buildOk: z.boolean(),
  testsOk: z.boolean(),
  lintOk: z.boolean(),
  reproductionStillFails: z.boolean(),
  testOutput: z.string(),
  buildOutput: z.string(),
  failureReason: z.string().optional(),
});

export type QAResult = z.infer<typeof QAResultSchema>;
