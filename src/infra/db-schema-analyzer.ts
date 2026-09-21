import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { isGeneratedArtifact, isIgnoredDirName } from './file-filter.js';

export interface DbSchemaIssue {
  severity: 'high' | 'medium' | 'low';
  area: string;
  issue: string;
  recommendation: string;
}

export interface DbSchemaReport {
  score: number;
  filesChecked: number;
  modelsChecked: number;
  fkWithoutIndexSignals: number;
  nullableWithoutDefaultSignals: number;
  missingUniqueSignals: number;
  tableWithoutPkSignals: number;
  relationWithoutOnDeleteSignals: number;
  issues: DbSchemaIssue[];
}

const SCHEMA_FILE_PATTERN = /(schema\.prisma$|\.entity\.(ts|js)$|\.model\.(ts|js)$|models?\.py$)/i;
const SENSITIVE_FIELD_NAME = /\b(email|cpf)\b/i;

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
      if (SCHEMA_FILE_PATTERN.test(entry.name)) files.push(rel);
    }
  };
  scan(cwd);
  return files.slice(0, 200);
}

function issue(issues: DbSchemaIssue[], severity: DbSchemaIssue['severity'], area: string, text: string, recommendation: string): void {
  issues.push({ severity, area, issue: text, recommendation });
}

// Prisma models are structured (`model X { ... }`), so they get exact block-scoped checks.
// Other ORMs (TypeORM/Sequelize/Django) get file-level signal counts — same heuristic style as db-analyzer.ts.
function analyzePrismaModels(content: string): {
  models: number;
  fkWithoutIndex: number;
  nullableWithoutDefault: number;
  missingUnique: number;
  withoutPk: number;
  relationWithoutOnDelete: number;
} {
  let models = 0;
  let fkWithoutIndex = 0;
  let nullableWithoutDefault = 0;
  let missingUnique = 0;
  let withoutPk = 0;
  let relationWithoutOnDelete = 0;

  const modelRegex = /model\s+\w+\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(content))) {
    models++;
    const body = match[1];
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);

    if (!/@id\b/.test(body) && !/@@id\s*\(/.test(body)) withoutPk++;

    for (const line of lines) {
      if (line.startsWith('@@')) continue;
      const fieldName = line.split(/\s+/)[0];
      if (!fieldName) continue;

      if (/@relation\s*\(/.test(line)) {
        const fkMatch = /fields:\s*\[([^\]]+)\]/.exec(line);
        if (fkMatch) {
          const fkFields = fkMatch[1].split(',').map((f) => f.trim());
          const indexed = fkFields.every((f) =>
            new RegExp(`@@(index|unique)\\s*\\(\\s*\\[[^\\]]*\\b${f}\\b`).test(body),
          );
          if (!indexed) fkWithoutIndex++;
        }
        if (!/onDelete\s*:/.test(line)) relationWithoutOnDelete++;
      }

      if (line.includes('?') && !/@default\s*\(/.test(line) && !/@relation/.test(line)) {
        nullableWithoutDefault++;
      }

      if (SENSITIVE_FIELD_NAME.test(fieldName) && !/@unique\b/.test(line)) {
        const hasModelUnique = new RegExp(`@@unique\\s*\\(\\s*\\[[^\\]]*\\b${fieldName}\\b`).test(body);
        if (!hasModelUnique) missingUnique++;
      }
    }
  }

  return { models, fkWithoutIndex, nullableWithoutDefault, missingUnique, withoutPk, relationWithoutOnDelete };
}

function analyzeGenericSchemaFile(content: string): {
  fkWithoutIndex: number;
  missingUnique: number;
} {
  let fkWithoutIndex = 0;
  let missingUnique = 0;

  const hasRelationDecorator = /@(ManyToOne|OneToMany|ManyToMany|OneToOne)\s*\(|ForeignKey\s*\(|foreignKey\s*:/i.test(content);
  const hasIndexSignal = /@Index\s*\(|db_index\s*=\s*True|index\s*:\s*true/i.test(content);
  if (hasRelationDecorator && !hasIndexSignal) fkWithoutIndex++;

  const sensitiveFieldDecl = /(email|cpf)['":\s]*[:=]/gi;
  const uniqueMatches = content.match(sensitiveFieldDecl) ?? [];
  for (const decl of uniqueMatches) {
    const idx = content.indexOf(decl);
    const context = content.slice(Math.max(0, idx - 40), idx + 120);
    if (!/unique\s*[:=]\s*true|unique\s*=\s*True/i.test(context)) missingUnique++;
  }

  return { fkWithoutIndex, missingUnique };
}

export function analyzeDbSchema(cwd: string): DbSchemaReport {
  const files = walk(cwd);
  let modelsChecked = 0;
  let fkWithoutIndexSignals = 0;
  let nullableWithoutDefaultSignals = 0;
  let missingUniqueSignals = 0;
  let tableWithoutPkSignals = 0;
  let relationWithoutOnDeleteSignals = 0;

  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }

    if (/schema\.prisma$/i.test(file)) {
      const r = analyzePrismaModels(content);
      modelsChecked += r.models;
      fkWithoutIndexSignals += r.fkWithoutIndex;
      nullableWithoutDefaultSignals += r.nullableWithoutDefault;
      missingUniqueSignals += r.missingUnique;
      tableWithoutPkSignals += r.withoutPk;
      relationWithoutOnDeleteSignals += r.relationWithoutOnDelete;
    } else {
      modelsChecked++;
      const r = analyzeGenericSchemaFile(content);
      fkWithoutIndexSignals += r.fkWithoutIndex;
      missingUniqueSignals += r.missingUnique;
    }
  }

  const issues: DbSchemaIssue[] = [];
  if (fkWithoutIndexSignals > 0) issue(issues, 'medium', 'Indexes', `${fkWithoutIndexSignals} foreign key relation(s) without a matching index`, 'Add an index (or @@index/@Index) on foreign key columns to keep joins and lookups fast as tables grow.');
  if (tableWithoutPkSignals > 0) issue(issues, 'high', 'Primary keys', `${tableWithoutPkSignals} model(s) without a declared primary key`, 'Every table should have an explicit primary key (@id / @@id) for safe updates, deletes, and replication.');
  if (missingUniqueSignals > 0) issue(issues, 'medium', 'Uniqueness', `${missingUniqueSignals} email/cpf-like field(s) without a unique constraint`, 'Add a unique constraint on identity fields (email, cpf) to prevent duplicate records at the database level.');
  if (relationWithoutOnDeleteSignals > 0) issue(issues, 'medium', 'Referential integrity', `${relationWithoutOnDeleteSignals} relation(s) without an explicit onDelete behavior`, 'Set onDelete (Cascade/SetNull/Restrict) explicitly instead of relying on the database default.');
  if (nullableWithoutDefaultSignals > 5) issue(issues, 'low', 'Schema clarity', `${nullableWithoutDefaultSignals} nullable field(s) without a default value`, 'Review nullable fields without defaults — confirm null is the intended default rather than an oversight.');
  if (files.length === 0) issue(issues, 'low', 'Visibility', 'No ORM schema files found (schema.prisma, *.entity.ts, *.model.ts, models.py)', 'If this app uses an ORM, document its schema location so it can be reviewed.');

  const deduction = issues.reduce((sum, i) => sum + (i.severity === 'high' ? 25 : i.severity === 'medium' ? 12 : 4), 0);
  return {
    score: Math.max(0, 100 - deduction),
    filesChecked: files.length,
    modelsChecked,
    fkWithoutIndexSignals,
    nullableWithoutDefaultSignals,
    missingUniqueSignals,
    tableWithoutPkSignals,
    relationWithoutOnDeleteSignals,
    issues,
  };
}
