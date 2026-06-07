import type { Command } from 'commander';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { buildProjectReportData, latestAuditPointer, projectReportPath, writeProjectReport } from '../../infra/project-report.js';

function openFile(path: string): void {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const target = process.platform === 'win32' ? path : `file://${path}`;
  const args = process.platform === 'win32' ? ['/c', 'start', '', path] : [target];
  const child = spawn(opener, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function terminalLink(label: string, path: string): string {
  const url = `file://${path}`;
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

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
          openFile(ensureUnifiedReport(cwd));
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
      const latest = latestAuditPointer(cwd);
      if (latest && !options.diagnostics) {
        const unified = projectReportPath(cwd);
        console.log(`Unified HTML: ${unified}`);
        console.log(`Latest run:    ${latest.html ?? latest.runDir ?? 'n/a'}`);
        if (options.open !== false) openFile(unified);
        return;
      }

      const days = parseInt(options.days, 10) || 90;
      const label = options.diagnostics ? 'diagnostics report' : 'report';
      console.log(chalk.bold.cyan(`\nBuilding ${label} for ${cwd.split('/').pop() ?? 'project'}\n`));
      const data = await buildProjectReportData(cwd, days, (message) => {
        console.log(chalk.gray(`  • ${message}`));
      });
      const written = writeProjectReport(cwd, data, Boolean(options.md));
      console.log(`Markdown: ${written.mdFile}`);
      if (written.htmlFile) {
        console.log(`HTML:     ${written.htmlFile}`);
        console.log('\n' + chalk.bold.cyan('📊 ') + terminalLink(chalk.bold.cyan('Abrir relatório no navegador →'), written.htmlFile));
        if (options.open !== false) openFile(written.htmlFile);
      }
      console.log(`  Health: ${data.health.badge}`);
      if (data.audit) console.log(`  Findings: ${data.audit.criticalCount} critical, ${data.audit.highCount} high`);
      console.log(`  Size: ~${Math.round(written.md.length / 1000)}k chars (~${Math.round(written.md.length / 4)} tokens)`);
    });
}
