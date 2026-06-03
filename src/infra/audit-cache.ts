import { readFileSync, writeFileSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';

const CACHE_FILE = '.ai-runtime/audit-cache.json';

interface CacheEntry {
  mtime: number;
  size: number;
}

interface AuditCache {
  version: 2;
  files: Record<string, CacheEntry>;
  lastAuditAt: string;
  lastFindings: Record<string, { severity: string; finding: string; recommendation: string; category: string; persona?: string }[]>;
}

export function loadAuditCache(cwd: string): AuditCache | null {
  try {
    const content = readFileSync(join(cwd, CACHE_FILE), 'utf8');
    const parsed = JSON.parse(content) as AuditCache;
    if (parsed.version !== 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAuditCache(
  cwd: string,
  files: string[],
  findings: Array<{ file: string; severity: string; finding: string; recommendation: string; category: string; persona?: string }>,
): void {
  const entries: Record<string, CacheEntry> = {};
  for (const f of files) {
    try {
      const st = statSync(join(cwd, f));
      entries[f] = { mtime: st.mtimeMs, size: st.size };
    } catch { /* skip */ }
  }

  // Group findings by file
  const lastFindings: AuditCache['lastFindings'] = {};
  for (const finding of findings) {
    if (!lastFindings[finding.file]) lastFindings[finding.file] = [];
    lastFindings[finding.file]!.push({
      severity: finding.severity,
      finding: finding.finding,
      recommendation: finding.recommendation,
      category: finding.category,
      persona: finding.persona,
    });
  }

  const cache: AuditCache = { version: 2, files: entries, lastAuditAt: new Date().toISOString(), lastFindings };
  mkdirSync(join(cwd, '.ai-runtime'), { recursive: true });
  writeFileSync(join(cwd, CACHE_FILE), JSON.stringify(cache, null, 2), 'utf8');
}

export function filterChangedFiles(
  cwd: string,
  files: string[],
  cache: AuditCache | null,
): { changed: string[]; unchanged: string[] } {
  if (!cache) return { changed: files, unchanged: [] };

  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const f of files) {
    const cached = cache.files[f];
    if (!cached) { changed.push(f); continue; }
    try {
      const st = statSync(join(cwd, f));
      if (st.mtimeMs !== cached.mtime || st.size !== cached.size) {
        changed.push(f);
      } else {
        unchanged.push(f);
      }
    } catch { changed.push(f); }
  }

  return { changed, unchanged };
}

export function getCachedFindingsForFiles(
  cache: AuditCache | null,
  unchangedFiles: string[],
): Array<{ file: string; severity: string; finding: string; recommendation: string; category: string; persona?: string }> {
  if (!cache) return [];
  const results: ReturnType<typeof getCachedFindingsForFiles> = [];
  for (const f of unchangedFiles) {
    const findings = cache.lastFindings[f];
    if (findings) {
      for (const finding of findings) {
        results.push({ file: f, ...finding });
      }
    }
  }
  return results;
}
