import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { isGeneratedArtifact, isIgnoredDirName } from './file-filter.js';

export interface DbConfigIssue {
  severity: 'high' | 'medium' | 'low';
  area: string;
  issue: string;
  recommendation: string;
}

export interface DbConfigReport {
  score: number;
  filesChecked: number;
  sslDisabledSignals: number;
  poolConfigSignals: number;
  timeoutConfigSignals: number;
  plaintextPasswordSignals: number;
  issues: DbConfigIssue[];
}

const CONFIG_FILE_PATTERN = /(^|[/\\])(\.env(\..+)?|docker-compose\.ya?ml|schema\.prisma|knexfile\.(js|ts|cjs|mjs)|typeorm\.config\.(js|ts))$/i;

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
      // Config filenames (.env, docker-compose.yml, ...) are checked directly against
      // entry.name rather than isIgnoredDirName, since .env deliberately starts with a dot.
      if (CONFIG_FILE_PATTERN.test(entry.name)) files.push(rel);
    }
  };
  scan(cwd);
  return files.slice(0, 200);
}

function issue(issues: DbConfigIssue[], severity: DbConfigIssue['severity'], area: string, text: string, recommendation: string): void {
  issues.push({ severity, area, issue: text, recommendation });
}

export function analyzeDbConfig(cwd: string): DbConfigReport {
  const files = walk(cwd);
  let sslDisabledSignals = 0;
  let poolConfigSignals = 0;
  let timeoutConfigSignals = 0;
  let plaintextPasswordSignals = 0;

  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }

    if (/sslmode\s*=\s*disable|ssl\s*[:=]\s*false/i.test(content)) sslDisabledSignals++;
    if (/connectionLimit|pool_size|poolSize|connection_limit|max\s*:\s*\d+\s*,?\s*\/\/?\s*pool/i.test(content)) poolConfigSignals++;
    if (/connect_timeout|connectionTimeout|connectTimeout|acquireTimeout/i.test(content)) timeoutConfigSignals++;
    if (/:\/\/[^:@/\s]+:[^@/\s]{3,}@/.test(content)) plaintextPasswordSignals++;
  }

  const issues: DbConfigIssue[] = [];
  if (sslDisabledSignals > 0) issue(issues, 'high', 'TLS', `${sslDisabledSignals} config(s) disable SSL/TLS for the database connection`, 'Enable sslmode=require (or the driver equivalent) for any non-local database connection.');
  if (plaintextPasswordSignals > 0) issue(issues, 'high', 'Secrets', `${plaintextPasswordSignals} connection string(s) embed a plaintext password`, 'Move credentials to environment variables or a secrets manager instead of inlining them in the connection string.');
  if (files.length > 0 && poolConfigSignals === 0) issue(issues, 'medium', 'Pooling', 'No connection pool size configuration detected', 'Set an explicit connection pool limit to avoid exhausting database connections under load.');
  if (files.length > 0 && timeoutConfigSignals === 0) issue(issues, 'medium', 'Timeouts', 'No connection/acquire timeout configuration detected', 'Set a connect/acquire timeout so a stalled database does not hang the whole app.');
  if (files.length === 0) issue(issues, 'low', 'Visibility', 'No database config files found (.env, docker-compose.yml, schema.prisma, knexfile, typeorm.config)', 'If this app uses a database, document its connection configuration in one of the expected config files.');

  const deduction = issues.reduce((sum, i) => sum + (i.severity === 'high' ? 25 : i.severity === 'medium' ? 12 : 4), 0);
  return {
    score: Math.max(0, 100 - deduction),
    filesChecked: files.length,
    sslDisabledSignals,
    poolConfigSignals,
    timeoutConfigSignals,
    plaintextPasswordSignals,
    issues,
  };
}
