import { saveTask, loadTask, updateTaskFields, appendHistory } from './store.js';
import type { TaskRecord, TaskRequest, TaskResult } from '../../core/task.js';
import type { TaskState } from '../../core/state-machine.js';

export function createTask(req: TaskRequest): TaskRecord {
  const record: TaskRecord = { ...req, state: 'NEW', updatedAt: new Date() };
  saveTask(record);
  return record;
}

export function getTask(id: string): TaskRecord | null {
  return loadTask(id) as TaskRecord | null;
}

export function updateTaskState(id: string, state: TaskState): void {
  updateTaskFields(id, { state });
}

export function saveTaskResult(id: string, result: TaskResult): void {
  updateTaskFields(id, { result });
}

export function logStateHistory(
  taskId: string,
  fromState: TaskState,
  toState: TaskState,
  agentName?: string,
): void {
  appendHistory({ taskId, fromState, toState, agentName });
}
