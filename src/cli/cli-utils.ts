export const SOURCE_EXTS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rb', '.rs', '.swift', '.kt', '.cs', '.cpp', '.c', '.h',
];

export const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.worktrees', 'coverage',
  '.next', '__pycache__', 'vendor', 'target', '.gradle', 'Pods',
  '.cache', 'tmp', 'temp', 'logs', 'fixtures', 'testdata',
  '.venv', 'venv', 'env',
]);

export function parseBudget(v: string): 'low' | 'normal' | 'deep' {
  return (['low', 'normal', 'deep'].includes(v) ? v : 'low') as 'low' | 'normal' | 'deep';
}

export function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  return Math.max(1, Math.min(max, parseInt(String(value), 10) || fallback));
}
