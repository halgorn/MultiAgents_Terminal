export { SOURCE_EXTS, IGNORE_DIRS, GENERATED_FILE_PATTERNS, isIgnoredDirName, isGeneratedArtifact } from '../infra/file-filter.js';

import { BUDGET_NAMES } from '../core/runtime-policy.js';

export function parseBudget(v: string): 'low' | 'normal' | 'deep' {
  return ((BUDGET_NAMES as readonly string[]).includes(v) ? v : 'low') as 'low' | 'normal' | 'deep';
}

export function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  return Math.max(1, Math.min(max, parseInt(String(value), 10) || fallback));
}
