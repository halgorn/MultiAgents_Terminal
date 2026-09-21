import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { isGeneratedArtifact, isIgnoredDirName } from './file-filter.js';

export interface DbPiiIssue {
  severity: 'high' | 'medium' | 'low';
  area: string;
  issue: string;
  recommendation: string;
}

export interface DbPiiReport {
  score: number;
  filesChecked: number;
  sensitiveFieldSignals: number;
  unprotectedPiiSignals: number;
  fields: string[];
  issues: DbPiiIssue[];
}

const SCHEMA_OR_MIGRATION_FILE = /(schema\.prisma$|\.entity\.(ts|js)$|\.model\.(ts|js)$|models?\.py$|migration|migrate)/i;
const SENSITIVE_FIELD_LINE = /\b(email|cpf|senha|password|phone|telefone|ssn|dob|date_of_birth)\b\s*[:=]?\s*(String|varchar|text|CharField|Column|@)/i;
const PROTECTION_SIGNAL = /select\s*:\s*false|encrypt|bcrypt|argon2|hash\s*\(|audit[_ ]?log/i;

function walk(cwd: string): string[] {
  const files: string[] = [];
  const scan = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (isIgnoredDirName(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relative(cwd, full);
      if (entry.isDirectory()) { scan(full); continue; }
      if (isGeneratedArtifact(rel)) continue;
      if (SCHEMA_OR_MIGRATION_FILE.test(entry.name)) files.push(rel);
    }
  };
  scan(cwd);
  return files.slice(0, 300);
}

function issue(issues: DbPiiIssue[], severity: DbPiiIssue['severity'], area: string, text: string, recommendation: string): void {
  issues.push({ severity, area, issue: text, recommendation });
}

export function analyzeDbPii(cwd: string): DbPiiReport {
  const files = walk(cwd);
  let sensitiveFieldSignals = 0;
  let unprotectedPiiSignals = 0;
  const fields = new Set<string>();

  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }

    const hasProtection = PROTECTION_SIGNAL.test(content);
    const lines = content.split('\n');
    for (const line of lines) {
      const match = SENSITIVE_FIELD_LINE.exec(line);
      if (!match) continue;
      sensitiveFieldSignals++;
      fields.add(match[1].toLowerCase());
      const lineHasProtection = /select\s*:\s*false|encrypt/i.test(line);
      if (!hasProtection && !lineHasProtection) unprotectedPiiSignals++;
    }
  }

  const issues: DbPiiIssue[] = [];
  if (unprotectedPiiSignals > 0) issue(issues, 'high', 'PII exposure', `${unprotectedPiiSignals} sensitive column(s) (${[...fields].join(', ') || 'PII'}) found without an encryption or select:false signal nearby`, 'Add field-level encryption, select: false, or an audit-logged access path for PII columns — required for LGPD/GDPR compliance.');
  if (files.length === 0) issue(issues, 'low', 'Visibility', 'No schema or migration files found to scan for PII columns', 'If this app stores personal data, document its schema/migrations so PII columns can be reviewed.');

  const deduction = issues.reduce((sum, i) => sum + (i.severity === 'high' ? 25 : i.severity === 'medium' ? 12 : 4), 0);
  return {
    score: Math.max(0, 100 - deduction),
    filesChecked: files.length,
    sensitiveFieldSignals,
    unprotectedPiiSignals,
    fields: [...fields],
    issues,
  };
}
