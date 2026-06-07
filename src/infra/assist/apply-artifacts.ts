import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { AssistArtifact, AssistPlan } from './types.js';

export interface ApplyResult {
  written: string[];
  skipped: string[];
}

function targetPath(cwd: string, artifact: AssistArtifact): string {
  if (artifact.path.includes('..') || artifact.path.startsWith('/')) {
    throw new Error(`Unsafe artifact path: ${artifact.path}`);
  }
  return join(cwd, artifact.path);
}

export function applyArtifacts(cwd: string, plan: AssistPlan, options: { dryRun?: boolean; overwrite?: boolean } = {}): ApplyResult {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const artifact of plan.artifacts) {
    const path = targetPath(cwd, artifact);
    if (existsSync(path) && !options.overwrite) {
      skipped.push(artifact.path);
      continue;
    }
    if (!options.dryRun) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, artifact.content, 'utf8');
      if (artifact.executable) chmodSync(path, 0o755);
    }
    written.push(artifact.path);
  }
  return { written, skipped };
}

export function formatArtifactSummary(result: ApplyResult): string {
  const lines = [];
  if (result.written.length > 0) lines.push(`Would write/write ${result.written.length} artifact(s):`, ...result.written.map((path) => `  - ${path}`));
  if (result.skipped.length > 0) lines.push(`Skipped existing ${result.skipped.length} artifact(s):`, ...result.skipped.map((path) => `  - ${path}`));
  return lines.join('\n');
}
