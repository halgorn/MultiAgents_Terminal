import type { RuntimePolicy } from './runtime-policy.js';
import type { KnowledgeStore } from '../infra/knowledge.js';
import type { TaskRecord } from './task.js';
import type { TaskState } from './state-machine.js';
import { assertTransition } from './state-machine.js';
import { updateTaskState, logStateHistory } from '../infra/db/task-repo.js';
import { createWorktree, removeWorktree } from '../infra/worktree.js';

export type PipelineEventMap = {
  'state:change': { taskId: string; state: TaskState };
  'agent:output': { agentName: string; text: string };
  'agent:start': { agentName: string };
  'agent:done': { agentName: string; durationMs: number };
  error: { taskId: string; message: string };
};

export type PipelineEmitter = <K extends keyof PipelineEventMap>(
  event: K,
  payload: PipelineEventMap[K],
) => void;

export interface PipelineContext {
  cwd: string;
  policy: RuntimePolicy;
  knowledge: KnowledgeStore;
  emit: PipelineEmitter;
  onChunk: (agentName: string, text: string) => void;
}

export async function transition(
  task: TaskRecord,
  to: TaskState,
  emit: PipelineEmitter,
  agentName?: string,
): Promise<void> {
  assertTransition(task.state, to);
  const from = task.state;
  task.state = to;
  updateTaskState(task.id, to);
  logStateHistory(task.id, from, to, agentName);
  emit('state:change', { taskId: task.id, state: to });
}

export function makeWorktreeTracker(cwd: string): {
  create: (name: string, taskId: string) => string;
  exclude: (name: string, taskId: string) => void;
  cleanup: () => void;
} {
  const worktrees: Array<[string, string]> = [];
  return {
    create(name, taskId) {
      const wt = createWorktree(cwd, name, taskId);
      worktrees.push([name, taskId]);
      return wt;
    },
    exclude(name, taskId) {
      const idx = worktrees.findIndex(([n, t]) => n === name && t === taskId);
      if (idx !== -1) worktrees.splice(idx, 1);
    },
    cleanup() {
      for (const [name, taskId] of worktrees) {
        try { removeWorktree(cwd, name, taskId); } catch { /* best-effort */ }
      }
    },
  };
}
