import type { Command } from 'commander';
import chalk from 'chalk';
import { copyFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { latestAuditPointer, projectReportPath } from '../../infra/project-report.js';
import { openReportFile, refreshUnifiedReport } from '../../infra/report-refresh.js';
import { displayProjectName } from '../../infra/project-name.js';
import { analyzeDatabase } from '../../infra/db-analyzer.js';
import { analyzeNetwork } from '../../infra/network-analyzer.js';

function ensureUnifiedReport(cwd: string): string {
  const reportPath = projectReportPath(cwd);
  if (!latestAuditPointer(cwd)) {
    throw new Error('No audit report found. Run: aion audit . --local-only');
  }
  if (!reportPath) {
    throw new Error('Could not resolve unified report path.');
  }
  return reportPath;
}

function printLatest(cwd: string): void {
  const latest = latestAuditPointer(cwd);
  if (!latest) {
    console.log(chalk.yellow('No audit report found. Run: aion audit . --local-only'));
    return;
  }
  console.log(chalk.bold.cyan('\nLatest Audit Report\n'));
  if (latest.createdAt) console.log(`  created:     ${latest.createdAt}`);
  if (latest.runDir) console.log(`  run dir:     ${latest.runDir}`);
  if (latest.html) console.log(`  html:        ${latest.html}`);
  if (latest.digest) console.log(`  digest:      ${latest.digest}`);
  if (latest.aiContext) console.log(`  ai context:  ${latest.aiContext}`);

  // Database summary (zero-token, runs locally)
  try {
    const db = analyzeDatabase(cwd);
    const scoreColor = db.score >= 75 ? chalk.green : db.score >= 50 ? chalk.yellow : chalk.red;
    const highIssues = db.issues.filter((i) => i.severity === 'high').length;
    console.log('');
    console.log(chalk.bold('── Database ────────────────────────────────────────────────'));
    console.log(`  score:       ${scoreColor(`${db.score}/100`)}`);
    if (db.ormSignals.length) console.log(`  orm:         ${chalk.dim(db.ormSignals.join(', '))}`);
    if (db.issues.length === 0) {
      console.log(chalk.dim('  No database issues detected.'));
    } else {
      console.log(`  issues:      ${db.issues.length} total${highIssues > 0 ? chalk.red(` · ${highIssues} high`) : ''}`);
      db.issues.slice(0, 3).forEach((i) => {
        const sev = i.severity === 'high' ? chalk.red(i.severity) : chalk.yellow(i.severity);
        console.log(`  ${sev}  ${chalk.dim(i.area)}  ${i.issue}`);
      });
      if (db.issues.length > 3) console.log(chalk.dim(`  … and ${db.issues.length - 3} more — see full report`));
    }
    console.log(chalk.dim('  Full view:   aion report  (visual dashboard → Database section)'));
  } catch { /* best-effort */ }

  // Network & API Security summary (zero-token, runs locally)
  try {
    const net = analyzeNetwork(cwd);
    const netScoreColor = net.score >= 75 ? chalk.green : net.score >= 50 ? chalk.yellow : chalk.red;
    const highNet = net.issues.filter((i) => i.severity === 'high').length;
    console.log('');
    console.log(chalk.bold('── Network & API Security ──────────────────────────────────'));
    console.log(`  score:       ${netScoreColor(`${net.score}/100`)}`);
    if (net.issues.length === 0) {
      console.log(chalk.dim('  No network/API issues detected.'));
    } else {
      console.log(`  issues:      ${net.issues.length} total${highNet > 0 ? chalk.red(` · ${highNet} high`) : ''}`);
      net.issues.slice(0, 3).forEach((i) => {
        const sev = i.severity === 'high' ? chalk.red(i.severity) : chalk.yellow(i.severity);
        console.log(`  ${sev}  ${chalk.dim(i.area)}  ${i.issue}`);
      });
      if (net.issues.length > 3) console.log(chalk.dim(`  … and ${net.issues.length - 3} more — see full report`));
    }
    console.log(chalk.dim('  Full view:   aion report  (visual dashboard → Network section)'));
  } catch { /* best-effort */ }

  console.log('');
  console.log(chalk.bold('── File guide ──────────────────────────────────────────────'));
  console.log(chalk.dim('  digest.md      — human-readable summary. Open this to read findings and priorities.'));
  console.log(chalk.dim('  ai-context.md  — compact machine context. Paste the path into an AI assistant to load the full audit.'));
  console.log(chalk.dim('  action-plan.md — prioritized list of fixes with exact file locations.'));
  console.log(chalk.dim('  index.html     — visual dashboard with trend charts and per-file breakdown.'));
  console.log('');
  console.log(chalk.bold('── Recommended ─────────────────────────────────────────────'));
  console.log(`  Human review:  ${chalk.cyan(latest.digest ?? latest.runDir ?? '')}`);
  console.log(`  Send to AI:    ${chalk.cyan(latest.aiContext ?? '')}`);
  console.log(`  Visual report: ${chalk.cyan(latest.html ?? latest.runDir ?? '')}`);
}

export function registerReport(program: Command): void {
  const report = program
    .command('report')
    .description('Generate full HTML + Markdown project report, or inspect latest audit report');

  report
    .command('latest')
    .description('Show the latest audit report paths and recommended files')
    .option('--open', 'open latest HTML report')
    .action((options: { open?: boolean }) => {
      const cwd = process.cwd();
      const latest = latestAuditPointer(cwd);
      printLatest(cwd);
      if (options.open && latest) {
        try {
          openReportFile(ensureUnifiedReport(cwd));
        } catch (err) {
          console.log(chalk.yellow(String((err as Error).message)));
        }
      }
    });

  report
    .option('--no-open', 'generate without opening browser')
    .option('--md', 'generate only Markdown (AI-ready context file)')
    .option('--json', 'print generated report paths as JSON')
    .option('--output <file>', 'copy generated HTML or Markdown report to this file')
    .option('--diagnostics', 'force a fresh zero-token local diagnostics HTML report')
    .option('--days <n>', 'git lookback for churn analysis', '90')
    .action(async (options: { open: boolean; md?: boolean; json?: boolean; output?: string; diagnostics?: boolean; days: string }) => {
      const cwd = process.cwd();
      const days = parseInt(options.days, 10) || 90;
      const label = options.diagnostics ? 'diagnostics report' : 'report';
      const written = await refreshUnifiedReport(cwd, {
        days,
        open: options.json || options.output || options.md ? false : options.open !== false,
        quiet: Boolean(options.json),
        mdOnly: Boolean(options.md),
        reason: `Building ${label} for ${displayProjectName(cwd)}`,
      });
      const primary = options.md ? written.mdFile : written.htmlFile ?? written.mdFile;
      if (options.output) {
        mkdirSync(dirname(options.output), { recursive: true });
        copyFileSync(primary, options.output);
      }
      if (options.json) {
        process.stdout.write(JSON.stringify({ markdown: written.mdFile, html: written.htmlFile, output: options.output }, null, 2) + '\n');
        return;
      }
      console.log(chalk.gray(`Markdown: ${written.mdFile}`));
      if (written.htmlFile) console.log(chalk.gray(`Dashboard: ${projectReportPath(cwd)}`));
      if (options.output) console.log(chalk.gray(`Output: ${options.output}`));
    });
}
