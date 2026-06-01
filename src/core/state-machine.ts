export const TaskState = {
  NEW: 'NEW',
  INVESTIGATING: 'INVESTIGATING',
  REPRODUCED: 'REPRODUCED',
  ROOT_CAUSE_FOUND: 'ROOT_CAUSE_FOUND',
  PATCH_CREATED: 'PATCH_CREATED',
  REVIEWED: 'REVIEWED',
  TESTED: 'TESTED',
  VERIFIED: 'VERIFIED',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;

export type TaskState = (typeof TaskState)[keyof typeof TaskState];

const TRANSITIONS: Record<TaskState, TaskState[]> = {
  NEW: ['INVESTIGATING', 'FAILED'],
  INVESTIGATING: ['REPRODUCED', 'FAILED'],
  REPRODUCED: ['ROOT_CAUSE_FOUND', 'FAILED'],
  ROOT_CAUSE_FOUND: ['PATCH_CREATED', 'FAILED'],
  PATCH_CREATED: ['REVIEWED', 'FAILED'],
  REVIEWED: ['TESTED', 'FAILED'],
  TESTED: ['VERIFIED', 'FAILED'],
  VERIFIED: ['DONE', 'FAILED'],
  DONE: [],
  FAILED: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal state transition: ${from} → ${to}`);
  }
}

export const STATE_ORDER: TaskState[] = [
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
];
