import type { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { AuditFinding } from '../../schemas/audit.js';
import { SEVERITY_RANK } from '../../schemas/audit.js';

interface SavedAuditReport {
  findings: AuditFinding[];
  criticalCount: number;
  highCount: number;
  totalFiles: number;
  summary: string;
  topPriorities: string[];
  durationMs?: number;
  createdAt?: string;
}

function loadReport(pathOrAlias: string, cwd: string): { report: SavedAuditReport; label: string } {
  // Support "latest", "prev", or absolute/relative file paths
  const dir = join(cwd, '.ai-runtime', 'reports');

  if (pathOrAlias === 'latest' || pathOrAlias === 'prev') {
    if (!existsSync(dir)) throw new Error('No audit reports found. Run `aion audit` first.');
    const files = readdirSync(dir).filter((f) => f.startsWith('audit-') && f.endsWith('.json')).sort();
    if (files.length === 0) throw new Error('No audit reports found in .ai-runtime/reports/');
    const idx = pathOrAlias === 'latest' ? files.length - 1 : Math.max(0, files.length - 2);
    const file = files[idx]!;
    const raw = readFileSync(join(dir, file), 'utf8');
    return { report: JSON.parse(raw), label: file };
  }

  // File path
  const resolvedPath = pathOrAlias.startsWith('/') ? pathOrAlias : join(cwd, pathOrAlias);
  if (!existsSync(resolvedPath)) throw new Error(`File not found: ${resolvedPath}`);
  const raw = readFileSync(resolvedPath, 'utf8');
  return { report: JSON.parse(raw), label: resolvedPath.split('/').pop() ?? resolvedPath };
}

function findingKey(f: AuditFinding): string {
  return `${f.file}:${f.line ?? ''}:${f.category}:${f.finding.slice(0, 80)}`;
}

function severityRank(s: string): number {
  return SEVERITY_RANK[s] ?? 0;
}

const SEV_COLOR: Record<string, (s: string) => string> = {
  critical: chalk.bgRed.white.bold,
  high: chalk.red.bold,
  medium: chalk.yellow,
  low: chalk.gray,
  info: chalk.dim,
};

function renderFinding(f: AuditFinding, prefix: string, prefixColor: (s: string) => string): void {
  const loc = f.line ? `${f.file}:${f.line}` : f.file;
  const sev = (SEV_COLOR[f.severity] ?? chalk.white)(f.severity);
  console.log(prefixColor(`${prefix} [${f.severity}]`) + chalk.bold(` ${loc}`) + (f.persona ? chalk.dim(` (${f.persona})`) : ''));
  console.log(`     ${f.finding}`);
  console.log(chalk.dim(`     → ${f.recommendation}`));
  console.log();
}

export function registerDiff(program: Command): void {
  program
    .command('diff [before] [after]')
    .description('Compare two audit runs. Defaults: before=prev, after=latest. Pass file paths or "prev"/"latest".')
    .option('--json', 'output raw JSON diff')
    .action(async (before: string = 'prev', after: string = 'latest', options: { json?: boolean }) => {
      const cwd = process.cwd();

      let beforeData: ReturnType<typeof loadReport>;
      let afterData: ReturnType<typeof loadReport>;

      try {
        beforeData = loadReport(before, cwd);
        afterData = loadReport(after, cwd);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exit(1);
      }

      const { report: beforeReport, label: beforeLabel } = beforeData;
      const { report: afterReport, label: afterLabel } = afterData;

      const beforeKeys = new Map<string, AuditFinding>(beforeReport.findings.map((f) => [findingKey(f), f]));
      const afterKeys = new Map<string, AuditFinding>(afterReport.findings.map((f) => [findingKey(f), f]));

      const added: AuditFinding[] = [];
      const resolved: AuditFinding[] = [];
      const escalated: Array<{ before: AuditFinding; after: AuditFinding }> = [];

      for (const [key, f] of afterKeys) {
        if (!beforeKeys.has(key)) added.push(f);
        else {
          const prev = beforeKeys.get(key)!;
          if (severityRank(f.severity) > severityRank(prev.severity)) escalated.push({ before: prev, after: f });
        }
      }
      for (const [key, f] of beforeKeys) {
        if (!afterKeys.has(key)) resolved.push(f);
      }

      added.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
      resolved.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

      if (options.json) {
        console.log(JSON.stringify({ before: beforeLabel, after: afterLabel, added, resolved, escalated }, null, 2));
        return;
      }

      console.log('\n' + chalk.bold('═'.repeat(60)));
      console.log(chalk.bold.cyan('  AUDIT DIFF'));
      console.log(chalk.dim(`  ${beforeLabel}  →  ${afterLabel}`));
      console.log(chalk.bold('═'.repeat(60)));

      const beforeCritical = beforeReport.findings.filter((f) => f.severity === 'critical').length;
      const beforeHigh = beforeReport.findings.filter((f) => f.severity === 'high').length;
      const afterCritical = afterReport.findings.filter((f) => f.severity === 'critical').length;
      const afterHigh = afterReport.findings.filter((f) => f.severity === 'high').length;

      const deltaTotal = afterReport.findings.length - beforeReport.findings.length;
      const deltaCritical = afterCritical - beforeCritical;
      const deltaHigh = afterHigh - beforeHigh;

      const sign = (n: number) => (n > 0 ? chalk.red(`+${n}`) : n < 0 ? chalk.green(String(n)) : chalk.gray('0'));

      console.log('');
      console.log(chalk.bold('Summary:'));
      console.log(`  Total findings:   ${beforeReport.findings.length} → ${afterReport.findings.length}  (${sign(deltaTotal)})`);
      console.log(`  Critical:         ${beforeCritical} → ${afterCritical}  (${sign(deltaCritical)})`);
      console.log(`  High:             ${beforeHigh} → ${afterHigh}  (${sign(deltaHigh)})`);
      console.log(`  New findings:     ${chalk.red(String(added.length))}`);
      console.log(`  Resolved:         ${chalk.green(String(resolved.length))}`);
      console.log(`  Escalated:        ${escalated.length > 0 ? chalk.yellow(String(escalated.length)) : chalk.gray('0')}`);

      if (added.length > 0) {
        console.log('\n' + chalk.red.bold(`── New Findings (${added.length}) ──────────────────────────────────`));
        console.log();
        for (const f of added) renderFinding(f, '+', chalk.red.bold);
      }

      if (resolved.length > 0) {
        console.log('\n' + chalk.green.bold(`── Resolved (${resolved.length}) ─────────────────────────────────────`));
        console.log();
        for (const f of resolved) renderFinding(f, '-', chalk.green);
      }

      if (escalated.length > 0) {
        console.log('\n' + chalk.yellow.bold(`── Escalated (${escalated.length}) ──────────────────────────────────`));
        console.log();
        for (const { before: bef, after: aft } of escalated) {
          const loc = aft.line ? `${aft.file}:${aft.line}` : aft.file;
          console.log(chalk.yellow(`  ↑ ${bef.severity} → ${aft.severity}`) + chalk.bold(`  ${loc}`));
          console.log(`     ${aft.finding}`);
          console.log();
        }
      }

      if (added.length === 0 && resolved.length === 0 && escalated.length === 0) {
        console.log('\n' + chalk.green('  No changes between audits.'));
      }

      console.log(chalk.bold('═'.repeat(60)));

      // CI exit code: fail if new criticals or highs introduced
      const newCriticals = added.filter((f) => f.severity === 'critical').length;
      const newHighs = added.filter((f) => f.severity === 'high').length;
      if (newCriticals > 0) process.exit(2);
      if (newHighs > 0) process.exit(1);
    });
}
