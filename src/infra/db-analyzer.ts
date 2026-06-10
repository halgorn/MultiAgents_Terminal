import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative } from 'path';
import { isGeneratedArtifact, isIgnoredDirName } from '../cli/cli-utils.js';

export interface DatabaseIssue {
  severity: 'high' | 'medium' | 'low';
  area: string;
  issue: string;
  recommendation: string;
}

export interface DatabaseReport {
  score: number;
  filesChecked: number;
  ormSignals: string[];
  migrationFiles: number;
  rawSqlFiles: number;
  indexSignals: number;
  queryTestSignals: number;
  transactionSignals: number;
  paginationSignals: number;
  poolSignals: number;
  relationRiskSignals: number;
  unboundedListSignals: number;
  issues: DatabaseIssue[];
}

const DB_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rb', '.java', '.sql', '.prisma']);
const ORM_PATTERNS: Array<[string, RegExp]> = [
  ['Prisma', /@prisma\/client|schema\.prisma|prisma\./i],
  ['TypeORM', /typeorm|@Entity\(|createQueryBuilder/i],
  ['Sequelize', /sequelize|Model\.init|DataTypes\./i],
  ['Drizzle', /drizzle-orm|pgTable|mysqlTable/i],
  ['Mongoose', /mongoose|Schema\(/i],
  ['SQLAlchemy', /sqlalchemy|declarative_base|Session\(/i],
  ['Django ORM', /django\.db|models\.Model/i],
  ['GORM', /gorm\.io|db\.(Find|Where|Create|Save)/i],
];

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
      if (DB_EXTS.has(extname(entry.name))) files.push(rel);
    }
  };
  scan(cwd);
  return files.slice(0, 500);
}

function hasDir(cwd: string, candidates: string[]): boolean {
  return candidates.some((path) => {
    try { return statSync(join(cwd, path)).isDirectory(); } catch { return false; }
  });
}

function issue(issues: DatabaseIssue[], severity: DatabaseIssue['severity'], area: string, text: string, recommendation: string): void {
  issues.push({ severity, area, issue: text, recommendation });
}

export function analyzeDatabase(cwd: string): DatabaseReport {
  const files = walk(cwd);
  const corpusParts: string[] = [];
  let migrationFiles = 0;
  let rawSqlFiles = 0;
  let indexSignals = 0;
  let queryTestSignals = 0;
  let transactionSignals = 0;
  let paginationSignals = 0;
  let poolSignals = 0;
  let relationRiskSignals = 0;
  let unboundedListSignals = 0;
  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }
    corpusParts.push(content.slice(0, 20000));
    if (/migration|migrate|schema\.prisma|liquibase|flyway/i.test(file)) migrationFiles++;
    if (/\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|cursor\.execute|db\.execute|queryRaw/i.test(content)) rawSqlFiles++;
    if (/CREATE\s+INDEX|@@index|@Index|index=True|db_index=True|\.index\(/i.test(content)) indexSignals++;
    if (/\.(test|spec)\.[tj]sx?$/.test(file) && /(db|query|repo|repository|orm)/i.test(file)) queryTestSignals++;
    if (/transaction|BEGIN TRANSACTION|COMMIT|ROLLBACK|atomic\(|session\.begin/i.test(content)) transactionSignals++;
    if (/LIMIT\s+\d+|OFFSET\s+\d+|take\s*:|skip\s*:|cursor\s*:|paginate|pageSize|perPage/i.test(content)) paginationSignals++;
    if (/pool|maxPoolSize|connectionLimit|pgbouncer|DATABASE_POOL|pool_timeout/i.test(content)) poolSignals++;
    if (/include\s*:\s*{|relations\s*:\s*\[|populate\(|preload\(|select_related|prefetch_related|JOIN\s+/i.test(content)) relationRiskSignals++;
    if (/\bfindMany\s*\(|\bSELECT\s+\*\b|\bgetMany\s*\(|\ball\s*\(|\btoArray\s*\(\)/i.test(content) && !/LIMIT\s+\d+|OFFSET\s+\d+|take\s*:|skip\s*:|cursor\s*:|paginate|pageSize|perPage/i.test(content)) unboundedListSignals++;
  }
  const corpus = corpusParts.join('\n');
  const ormSignals = ORM_PATTERNS.filter(([, pattern]) => pattern.test(corpus)).map(([name]) => name);
  const packageJson = existsSync(join(cwd, 'package.json')) ? readFileSync(join(cwd, 'package.json'), 'utf8') : '';
  const likelyDb = ormSignals.length > 0 || /postgres|mysql|sqlite|mongodb|redis|supabase|neon|planetscale/i.test(`${corpus}\n${packageJson}`);
  const migrationsDir = hasDir(cwd, ['migrations', 'db/migrations', 'prisma/migrations', 'src/migrations']);
  const issues: DatabaseIssue[] = [];
  if (likelyDb && migrationFiles === 0 && !migrationsDir) issue(issues, 'high', 'Schema lifecycle', 'Database usage detected but no migrations found', 'Add migration tracking so future schema changes are reviewable and reversible.');
  if (rawSqlFiles > 0 && indexSignals === 0) issue(issues, 'medium', 'Indexes', 'Raw SQL/query usage found without index signals', 'Map query predicates to indexes and include index checks in migrations.');
  if (rawSqlFiles > 5) issue(issues, 'medium', 'Query ownership', `${rawSqlFiles} files contain raw SQL/query calls`, 'Centralize query access in repositories/services and add query-level tests.');
  if (rawSqlFiles > 0 && queryTestSignals === 0) issue(issues, 'low', 'Query tests', 'Database query usage found without query test signals', 'Add focused tests for repositories, queries, and migration regressions.');
  if (likelyDb && transactionSignals === 0) issue(issues, 'medium', 'Consistency', 'No transaction handling signal detected', 'Use explicit transactions for multi-write workflows and critical domain operations.');
  if (likelyDb && paginationSignals === 0) issue(issues, 'medium', 'Growth projection', 'No pagination/cursor signal detected', 'Add cursor or limit/offset pagination before list endpoints grow unbounded.');
  if (likelyDb && poolSignals === 0) issue(issues, 'low', 'Connection scaling', 'No database pool configuration signal detected', 'Document connection pooling limits for serverless, workers, and production API concurrency.');
  if (relationRiskSignals > 0 && transactionSignals === 0) issue(issues, 'low', 'Relational loading', `${relationRiskSignals} relation loading signal(s) without transaction context`, 'Review relation loading for N+1 queries and consistency-sensitive reads.');
  if (unboundedListSignals > 0) issue(issues, 'medium', 'List growth', `${unboundedListSignals} potentially unbounded list query signal(s)`, 'Add pagination or cursor limits to list queries before traffic grows.');
  if (!likelyDb) issue(issues, 'low', 'Visibility', 'No strong database signal detected', 'If this app uses an external DB indirectly, document the data model and access layer.');
  const deduction = issues.reduce((sum, item) => sum + (item.severity === 'high' ? 25 : item.severity === 'medium' ? 12 : 4), 0);
  return {
    score: Math.max(0, 100 - deduction),
    filesChecked: files.length,
    ormSignals,
    migrationFiles,
    rawSqlFiles,
    indexSignals,
    queryTestSignals,
    transactionSignals,
    paginationSignals,
    poolSignals,
    relationRiskSignals,
    unboundedListSignals,
    issues,
  };
}
