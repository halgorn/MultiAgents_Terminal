import type { Command } from 'commander';
import chalk from 'chalk';
import { latestAuditPointer, projectReportPath } from '../../infra/project-report.js';
import { openReportFile, refreshUnifiedReport } from '../../infra/report-refresh.js';

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
  console.log('');
  console.log(chalk.bold('Recommended:'));
  console.log(`  Human review: ${chalk.cyan(latest.digest ?? latest.runDir ?? '')}`);
  console.log(`  Send to AI:   ${chalk.cyan(latest.aiContext ?? '')}`);
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
    .option('--diagnostics', 'force a fresh zero-token local diagnostics HTML report')
    .option('--days <n>', 'git lookback for churn analysis', '90')
    .action(async (options: { open: boolean; md?: boolean; diagnostics?: boolean; days: string }) => {
      const cwd = process.cwd();
      const days = parseInt(options.days, 10) || 90;
      const label = options.diagnostics ? 'diagnostics report' : 'report';
      const written = await refreshUnifiedReport(cwd, {
        days,
        open: options.md ? false : options.open !== false,
        mdOnly: Boolean(options.md),
        reason: `Building ${label} for ${cwd.split('/').pop() ?? 'project'}`,
      });
      console.log(chalk.gray(`Markdown: ${written.mdFile}`));
      if (written.htmlFile) console.log(chalk.gray(`Dashboard: ${projectReportPath(cwd)}`));
    });
}
