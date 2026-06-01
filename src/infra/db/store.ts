import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STORE_DIR = process.env['AI_RUNTIME_DB_PATH'] ?? join(homedir(), '.ai-runtime');

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function readJson<T>(filepath: string): T | null {
  try {
    return JSON.parse(readFileSync(filepath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(filepath: string, data: unknown): void {
  const tmp = filepath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, filepath);
}

// ── Tasks ────────────────────────────────────────────────────────────────────

const tasksDir = (): string => {
  const d = join(STORE_DIR, 'tasks');
  ensureDir(d);
  return d;
};

export function saveTask(task: unknown): void {
  const t = task as { id: string };
  writeJson(join(tasksDir(), `${t.id}.json`), task);
}

export function loadTask(id: string): unknown | null {
  return readJson(join(tasksDir(), `${id}.json`));
}

export function updateTaskFields(id: string, fields: Record<string, unknown>): void {
  const existing = loadTask(id);
  if (!existing) return;
  writeJson(join(tasksDir(), `${id}.json`), { ...(existing as object), ...fields, updatedAt: new Date() });
}

// ── Evidence ─────────────────────────────────────────────────────────────────

const evidenceDir = (taskId: string): string => {
  const d = join(STORE_DIR, 'evidence', taskId);
  ensureDir(d);
  return d;
};

export function saveEvidenceEntry(taskId: string, agentName: string, report: unknown): void {
  const filename = `${agentName}-${Date.now()}.json`;
  writeJson(join(evidenceDir(taskId), filename), { agentName, report });
}

export function loadEvidence(taskId: string): unknown[] {
  const dir = join(STORE_DIR, 'evidence', taskId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(join(dir, f)))
    .filter(Boolean);
}

// ── State History ─────────────────────────────────────────────────────────────

const historyDir = (): string => {
  const d = join(STORE_DIR, 'history');
  ensureDir(d);
  return d;
};

export function appendHistory(entry: {
  taskId: string;
  fromState: string;
  toState: string;
  agentName?: string;
}): void {
  const file = join(historyDir(), `${entry.taskId}.jsonl`);
  const line = JSON.stringify({ ...entry, timestamp: Date.now() }) + '\n';
  try {
    appendFileSync(file, line, 'utf8');
  } catch { /* best-effort */ }
}
