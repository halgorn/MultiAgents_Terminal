import type { TaskState } from './state-machine.js';
import type { EvidenceReport } from '../schemas/evidence.js';
import type { PlanReport } from '../schemas/plan.js';
import type { PatchReport } from '../schemas/patch.js';
import type { ReviewReport } from '../schemas/review.js';
import type { QAResult } from '../schemas/qa.js';

export interface TaskRequest {
  id: string;
  command: 'analyze' | 'fix' | 'review';
  target: string;
  cwd: string;
  createdAt: Date;
}

export interface TaskRecord extends TaskRequest {
  state: TaskState;
  updatedAt: Date;
}

export interface TaskResult {
  taskId: string;
  state: TaskState;
  plan?: PlanReport;
  evidence?: EvidenceReport;
  patch?: PatchReport;
  review?: ReviewReport;
  qaResult?: QAResult;
  errors: string[];
  durationMs: number;
}
