import { z } from 'zod';

// Mirrors core/state-machine.ts TaskState literals. Duplicated rather than imported
// to keep schemas a dependency-free leaf (core/task.ts already imports from schemas;
// importing core here would create a cycle). schemas.test.ts cross-checks the two lists.
export const TASK_STATE_VALUES = [
  'NEW',
  'INVESTIGATING',
  'REPRODUCED',
  'ROOT_CAUSE_FOUND',
  'PATCH_CREATED',
  'REVIEWED',
  'TESTED',
  'VERIFIED',
  'DONE',
  'FAILED',
] as const;

export const TaskRecordSchema = z.object({
  id: z.string().min(1),
  command: z.enum(['analyze', 'fix', 'review']),
  target: z.string(),
  cwd: z.string(),
  createdAt: z.coerce.date(),
  state: z.enum(TASK_STATE_VALUES),
  updatedAt: z.coerce.date(),
});

export type TaskRecordParsed = z.infer<typeof TaskRecordSchema>;
