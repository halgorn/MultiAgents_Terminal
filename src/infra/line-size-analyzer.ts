import { readdirSync, readFileSync } from 'fs';
import { extname, join, relative } from 'path';
import { SOURCE_EXTS, isGeneratedArtifact, isIgnoredDirName } from './file-filter.js';

export interface LineSizeEntry {
  file: string;
  lines: number;
  overBy: number;
}

export interface LineSizeReport {
  limit: number;
  checkedFiles: number;
  oversized: LineSizeEntry[];
  score: number;
}

const SOURCE_EXT_SET = new Set(SOURCE_EXTS);

function walk(dir: string, cwd: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isIgnoredDirName(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walk(full, cwd));
        continue;
      }
      if (!SOURCE_EXT_SET.has(extname(entry.name))) continue;
      if (isGeneratedArtifact(full)) continue;
      files.push(relative(cwd, full));
    }
  } catch {
    return files;
  }
  return files;
}

export function analyzeLineSize(cwd: string, limit = 500): LineSizeReport {
  const files = walk(cwd, cwd);
  const oversized: LineSizeEntry[] = [];

  for (const file of files) {
    let lines = 0;
    try {
      lines = readFileSync(join(cwd, file), 'utf8').split('\n').length;
    } catch {
      continue;
    }
    if (lines > limit) oversized.push({ file, lines, overBy: lines - limit });
  }

  oversized.sort((a, b) => b.overBy - a.overBy || a.file.localeCompare(b.file));
  const penalty = Math.min(60, oversized.length * 10 + oversized.reduce((sum, entry) => sum + Math.min(10, Math.ceil(entry.overBy / 100)), 0));
  return { limit, checkedFiles: files.length, oversized, score: Math.max(40, 100 - penalty) };
}
