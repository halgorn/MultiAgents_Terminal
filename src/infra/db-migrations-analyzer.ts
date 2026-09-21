import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { isGeneratedArtifact, isIgnoredDirName } from './file-filter.js';

export interface DbMigrationIssue {
  severity: 'high' | 'medium' | 'low';
  area: string;
  issue: string;
  recommendation: string;
}

export interface DbMigrationReport {
  score: number;
  filesChecked: number;
  dropColumnSignals: number;
  fkWithoutIndexSignals: number;
  irreversibleSignals: number;
  riskyAlterSignals: number;
  issues: DbMigrationIssue[];
}

const MIGRATION_FILE_PATTERN = /(^|[/\\])migrations?[/\\].*\.(sql|js|ts|cjs|mjs|py)$|[/\\_-]migrat(e|ion)[a-z0-9_-]*\.(sql|js|ts|cjs|mjs|py)$/i;

function walk(cwd: string): string[] {
  const files: string[] = [];
  const scan = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isIgnoredDirName(entry.name)) continue;
        scan(join(dir, entry.name));
        continue;
      }
      const full = join(dir, entry.name);
      const rel = relative(cwd, full);
      if (isGeneratedArtifact(rel)) continue;
      if (MIGRATION_FILE_PATTERN.test(rel)) files.push(rel);
    }
  };
  scan(cwd);
  return files.slice(0, 500);
}

function issue(issues: DbMigrationIssue[], severity: DbMigrationIssue['severity'], area: string, text: string, recommendation: string): void {
  issues.push({ severity, area, issue: text, recommendation });
}

export function analyzeDbMigrations(cwd: string): DbMigrationReport {
  const files = walk(cwd);
  let dropColumnSignals = 0;
  let fkWithoutIndexSignals = 0;
  let irreversibleSignals = 0;
  let riskyAlterSignals = 0;

  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }

    if (/drop\s+column/i.test(content)) dropColumnSignals++;

    const hasFk = /foreign\s+key|references\s+\w+\s*\(/i.test(content);
    const hasIndex = /create\s+(unique\s+)?index|@@index\s*\(/i.test(content);
    if (hasFk && !hasIndex) fkWithoutIndexSignals++;

    const hasUp = /\bup\s*\(|exports\.up\s*=|def\s+up\s*\(/i.test(content);
    const hasDown = /\bdown\s*\(|exports\.down\s*=|def\s+down\s*\(/i.test(content);
    if (hasUp && !hasDown) irreversibleSignals++;

    if (/alter\s+table[\s\S]{0,200}?add\s+(column\s+)?\S+[\s\S]{0,100}?not\s+null/i.test(content) && !/default/i.test(content)) {
      riskyAlterSignals++;
    }
  }

  const issues: DbMigrationIssue[] = [];
  if (dropColumnSignals > 0) issue(issues, 'high', 'Destructive changes', `${dropColumnSignals} migration(s) drop a column with no visible dependency check`, 'Verify no code still reads the dropped column; prefer a deprecate-then-drop two-step migration.');
  if (fkWithoutIndexSignals > 0) issue(issues, 'medium', 'Indexes', `${fkWithoutIndexSignals} migration(s) add a foreign key without a corresponding index`, 'Add an index on the FK column in the same migration to avoid slow joins and lock contention.');
  if (irreversibleSignals > 0) issue(issues, 'medium', 'Reversibility', `${irreversibleSignals} migration(s) define up() with no matching down()`, 'Add a down()/rollback path so a bad deploy can be reverted safely.');
  if (riskyAlterSignals > 0) issue(issues, 'medium', 'Locking', `${riskyAlterSignals} migration(s) add a NOT NULL column with no DEFAULT`, 'On large tables this locks writes for the duration; add a DEFAULT or backfill in batches instead.');
  if (files.length === 0) issue(issues, 'low', 'Visibility', 'No migration files found', 'If this app uses a migration-based schema workflow, this scanner will pick it up once migrations exist.');

  const deduction = issues.reduce((sum, i) => sum + (i.severity === 'high' ? 25 : i.severity === 'medium' ? 12 : 4), 0);
  return {
    score: Math.max(0, 100 - deduction),
    filesChecked: files.length,
    dropColumnSignals,
    fkWithoutIndexSignals,
    irreversibleSignals,
    riskyAlterSignals,
    issues,
  };
}
