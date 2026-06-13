import { readdirSync, statSync } from 'fs';
import { join as pathJoin } from 'path';
import { spawnSync } from 'child_process';
import { loadIgnorePatterns, isIgnored } from '../../infra/aion-ignore.js';
import { rankFilesByRisk, buildCognitiveScores } from '../../infra/code-metrics.js';
import { SOURCE_EXTS, IGNORE_DIRS, isGeneratedArtifact, isIgnoredDirName } from '../../infra/file-filter.js';
export { SOURCE_EXTS, IGNORE_DIRS };
export const IGNORE_PATTERNS = [
  /\.min\.[jt]sx?$/,
  /\.d\.ts$/,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /generated/i,
  /\.pb\.[jt]sx?$/,
];
export const MAX_FILE_SIZE = 200 * 1024;

export interface AuditFileStats {
  totalFiles: number;
  auditFiles: string[];
  ignoredDirs: number;
  ignoredFiles: number;
  oversizedFiles: number;
  byExtension: Record<string, number>;
}

export function fetchGitChurn(cwd: string, days = 90): Map<string, number> {
  const result = spawnSync('git', ['log', '--name-only', '--pretty=format:', `--since=${days}.days.ago`], {
    cwd, encoding: 'utf8', timeout: 10000,
  });
  const counts = new Map<string, number>();
  for (const line of (result.stdout ?? '').split('\n')) {
    const t = line.trim();
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

export function collectAuditStats(cwd: string, target: string): AuditFileStats {
  const stats: AuditFileStats = {
    totalFiles: 0,
    auditFiles: [],
    ignoredDirs: 0,
    ignoredFiles: 0,
    oversizedFiles: 0,
    byExtension: {},
  };

  const ignorePatterns = loadIgnorePatterns(cwd);
  const root = pathJoin(cwd, target || '.');
  const rootRel = target && target !== '.' ? target.replace(/^[./]+/, '') : '';

  const walk = (dir: string, rel: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      const fullPath = pathJoin(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      try {
        const st = statSync(fullPath);
        if (isIgnoredDirName(entry)) {
          if (st.isDirectory()) stats.ignoredDirs++;
          else stats.ignoredFiles++;
          continue;
        }
        if (st.isDirectory()) { walk(fullPath, relPath); continue; }

        stats.totalFiles++;
        const ext = SOURCE_EXTS.find((candidate) => entry.endsWith(candidate));
        if (!ext) { stats.ignoredFiles++; continue; }
        stats.byExtension[ext] = (stats.byExtension[ext] ?? 0) + 1;

        if (IGNORE_PATTERNS.some((p) => p.test(relPath)) || isGeneratedArtifact(relPath) || isIgnored(relPath, ignorePatterns)) {
          stats.ignoredFiles++;
        } else if (st.size >= MAX_FILE_SIZE) {
          stats.oversizedFiles++;
        } else {
          stats.auditFiles.push(rootRel ? `${rootRel}/${relPath}` : relPath);
        }
      } catch { /* skip unreadable */ }
    }
  };

  walk(root, '');
  stats.auditFiles.sort();
  return stats;
}

export function prioritizeFiles(
  cwd: string,
  files: string[],
  max: number,
  extra?: { semgrepFiles?: Set<string>; hotspotFiles?: string[] },
): string[] {
  if (files.length <= max) return files;

  const churnCounts = fetchGitChurn(cwd);
  const cognitiveScores = buildCognitiveScores(cwd, files);

  const depFanIn = new Map<string, number>();
  for (const h of extra?.hotspotFiles ?? []) {
    depFanIn.set(h, (depFanIn.get(h) ?? 0) + 5);
  }

  const ranked = rankFilesByRisk(files, {
    churnCounts,
    depFanIn,
    semgrepFiles: extra?.semgrepFiles,
    cognitiveScores,
  });

  return ranked.slice(0, max).map((r) => r.file).sort();
}
