import type { Command } from 'commander';
import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { buildProjectReportData, latestAuditPointer, writeProjectReport } from '../../infra/project-report.js';

function openFile(path: string): void {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', path] : [path];
  spawnSync(opener, args, { stdio: 'ignore', timeout: 5000 });
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
  if (latest.actionPlan) console.log(`  action plan: ${latest.actionPlan}`);
  console.log('');
  console.log(chalk.bold('Recommended:'));
  console.log(`  Human review: ${chalk.cyan(latest.digest ?? latest.summary ?? latest.runDir ?? '')}`);
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
      if (options.open && latest?.html) openFile(latest.html);
    });

  report
    .option('--no-open', 'generate without opening browser')
    .option('--md', 'generate only Markdown (AI-ready context file)')
    .option('--days <n>', 'git lookback for churn analysis', '90')
    .action(async (options: { open: boolean; md?: boolean; days: string }) => {
      const cwd = process.cwd();
      const days = parseInt(options.days, 10) || 90;
      console.log(`Building report for ${cwd.split('/').pop() ?? 'project'}...`);
      const data = await buildProjectReportData(cwd, days);
      const written = writeProjectReport(cwd, data, Boolean(options.md));
      console.log(`Markdown: ${written.mdFile}`);
      if (written.htmlFile) {
        console.log(`HTML:     ${written.htmlFile}`);
        if (options.open !== false) openFile(written.htmlFile);
      }
      console.log(`  Health: ${data.health.badge}`);
      if (data.audit) console.log(`  Findings: ${data.audit.criticalCount} critical, ${data.audit.highCount} high`);
      console.log(`  Size: ~${Math.round(written.md.length / 1000)}k chars (~${Math.round(written.md.length / 4)} tokens)`);
    });
}
