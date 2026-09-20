import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskRecordSchema, TASK_STATE_VALUES } from './task.js';
import { TaskState } from '../core/state-machine.js';

test('TASK_STATE_VALUES stays in sync with core TaskState', () => {
  assert.deepEqual([...TASK_STATE_VALUES].sort(), Object.values(TaskState).sort());
});

test('TaskRecordSchema parses a valid record and coerces date strings', () => {
  const result = TaskRecordSchema.safeParse({
    id: 'task-1',
    command: 'analyze',
    target: '.',
    cwd: '/repo',
    createdAt: '2026-01-01T00:00:00.000Z',
    state: 'NEW',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.ok(result.success);
  assert.ok(result.data!.createdAt instanceof Date);
});

test('TaskRecordSchema rejects an unknown state', () => {
  const result = TaskRecordSchema.safeParse({
    id: 'task-1',
    command: 'analyze',
    target: '.',
    cwd: '/repo',
    createdAt: new Date(),
    state: 'NOT_A_STATE',
    updatedAt: new Date(),
  });
  assert.equal(result.success, false);
});
