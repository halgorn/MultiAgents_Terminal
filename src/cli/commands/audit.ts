import type { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Orchestrator } from '../../core/orchestrator.js';
import { AuditPipeline } from '../../core/pipelines/audit-pipeline.js';
import { createRuntimePolicy } from '../../core/runtime-policy.js';
import { CostTracker } from '../../core/cost-tracker.js';
import { Renderer } from '../ui/renderer.js';
import type { AuditFinding } from '../../schemas/audit.js';

const SEVERITY_COLOR: Record<string, (s: string) => string> = {
  critical: chalk.bgRed.white.bold,
  high:     chalk.red.bold,
  medium:   chalk.yellow,
  low:      chalk.gray,
  info:     chalk.dim,
};

const SEVERITY_ICON: Record<string, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '⚪',
  info:     '🔵',
};

function renderAuditReport(report: {
  findings: AuditFinding[];
  criticalCount: number;
  highCount: number;
  totalFiles: number;
  summary: string;
  topPriorities: string[];
}, durationMs: number): void {
  console.log('\n' + chalk.bold('═'.repeat(60)));
  console.log(chalk.bold.cyan('  AUDIT REPORT') + chalk.gray(` — ${report.totalFiles} files — ${(durationMs / 1000).toFixed(1)}s`));
  console.log(chalk.bold('═'.repeat(60)));

  // Summary
  console.log('\n' + chalk.bold('Summary:'));
  console.log('  ' + report.summary);

  // Counts
  const counts = [
    report.criticalCount > 0 ? chalk.bgRed.white.bold(` ${report.criticalCount} critical `) : null,
    report.highCount > 0 ? chalk.red.bold(`${report.highCount} high`) : null,
    chalk.gray(`${report.findings.filter(f => f.severity === 'medium').length} medium`),
    chalk.gray(`${report.findings.filter(f => f.severity === 'low').length} low`),
  ].filter(Boolean);
  console.log('\n' + chalk.bold('Severity:') + '  ' + counts.join('  '));

  // Top priorities
  if (report.topPriorities.length > 0) {
    console.log('\n' + chalk.bold('Top Priorities:'));
    report.topPriorities.forEach((p, i) => {
      console.log(chalk.cyan(`  ${i + 1}.`) + ' ' + p);
    });
  }

  // Findings grouped by severity
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  for (const sev of order) {
    const group = report.findings.filter(f => f.severity === sev);
    if (group.length === 0) continue;

    const color = SEVERITY_COLOR[sev] ?? chalk.white;
    const icon = SEVERITY_ICON[sev] ?? '';
    console.log('\n' + color(` ${icon} ${sev.toUpperCase()} (${group.length}) `));

    for (const f of group) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      console.log(chalk.bold(`  ${loc}`) + chalk.gray(` [${f.category}]`));
      console.log(`    ${f.finding}`);
      console.log(chalk.dim(`    → ${f.recommendation}`));
      console.log();
    }
  }

  console.log(chalk.bold('═'.repeat(60)));
}

function saveAuditReport(report: {
  findings: AuditFinding[];
  criticalCount: number;
  highCount: number;
  totalFiles: number;
  summary: string;
  topPriorities: string[];
}, durationMs: number): string {
  const dir = join(process.cwd(), '.ai-runtime', 'reports');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `audit-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ ...report, durationMs, createdAt: new Date().toISOString() }, null, 2), 'utf8');
  return file;
}

function renderDryRun(stats: ReturnType<AuditPipeline['collectAuditStats']>): void {
  console.log('\n' + chalk.bold.cyan('Audit dry run'));
  console.log(chalk.gray('No agents were started and no API tokens were used.'));
  console.log(`  total files seen: ${stats.totalFiles}`);
  console.log(`  audit source files: ${stats.auditFiles.length}`);
  console.log(`  ignored directories: ${stats.ignoredDirs}`);
  console.log(`  ignored/non-source files: ${stats.ignoredFiles}`);
  console.log(`  oversized source files: ${stats.oversizedFiles}`);

  const exts = Object.entries(stats.byExtension).sort((a, b) => b[1] - a[1]);
  if (exts.length > 0) {
    console.log('\n' + chalk.bold('Extensions:'));
    exts.forEach(([ext, count]) => console.log(`  ${ext}: ${count}`));
  }

  if (stats.auditFiles.length > 0) {
    console.log('\n' + chalk.bold('Sample:'));
    stats.auditFiles.slice(0, 10).forEach((file) => console.log(`  ${file}`));
  }
}

export function registerAudit(program: Command): void {
  program
    .command('audit [target]')
    .description('Deep parallel audit: N scanners cover all files, synthesizer unifies findings')
    .option('-n, --scanners <n>', 'number of parallel scanner agents', '5')
    .option('--dry-run', 'collect audit file stats without starting agents')
    .action(async (target: string = '.', options: { scanners: string; dryRun?: boolean }) => {
      const n = Math.max(1, Math.min(10, parseInt(options.scanners, 10) || 5));
      const renderer = new Renderer();
      const orch = new Orchestrator(process.cwd());

      if (options.dryRun) {
        const pipeline = new AuditPipeline(process.cwd(), createRuntimePolicy(), new CostTracker(), () => {}, () => {});
        renderDryRun(pipeline.collectAuditStats(target));
        return;
      }

      orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
      orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
      orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));

      const start = Date.now();
      console.log(chalk.bold.cyan(`\nStarting audit with ${n} parallel scanners...\n`));

      try {
        const report = await orch.runAuditPipeline(target, n);
        const durationMs = Date.now() - start;
        renderAuditReport(report, durationMs);
        console.log(chalk.gray(`report: ${saveAuditReport(report, durationMs)}`));
        console.log(chalk.dim(orch.costs.summary()));
        process.exit(report.criticalCount > 0 ? 2 : report.highCount > 0 ? 1 : 0);
      } catch (err) {
        renderer.showError(err);
        process.exit(1);
      }
    });
}
