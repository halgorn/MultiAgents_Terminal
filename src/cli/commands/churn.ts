import type { Command } from 'commander';
import chalk from 'chalk';
import { buildChurnReport } from '../../infra/git-analysis.js';
import { GraphAgent } from '../../agents/graph-agent.js';

const RISK_COLOR: Record<string, (s: string) => string> = {
  critical: chalk.bgRed.white.bold,
  high: chalk.red.bold,
  medium: chalk.yellow,
  low: chalk.gray,
};

export function registerChurn(program: Command): void {
  program
    .command('churn [target]')
    .description('Git churn analysis: files changed most often + bus factor (knowledge silos)')
    .option('--days <n>', 'lookback period in days', '90')
    .option('--top <n>', 'number of files to show', '20')
    .option('--bus-factor-days <n>', 'bus factor lookback in days', '180')
    .action(async (_target: string = '.', options: { days: string; top: string; busFactorDays: string }) => {
      const cwd = process.cwd();
      const days = parseInt(options.days, 10) || 90;
      const top = parseInt(options.top, 10) || 20;
      const bfDays = parseInt(options.busFactorDays, 10) || 180;

      console.log(chalk.bold.cyan(`\nGit Analysis — last ${days} days\n`));

      // Get hotspot files from graph index for bus factor
      let hotspotFiles: string[] = [];
      try {
        const graph = new GraphAgent(cwd);
        const index = graph.getIndex();
        if (index) {
          // Import dep-graph lazily
          const { detectLang } = await import('../../infra/lang-detect.js');
          const { buildDepGraphAuto } = await import('../../infra/dep-graph.js');
          
          const lang = detectLang(cwd);
          const dep = buildDepGraphAuto(cwd, lang.lang);
          hotspotFiles = dep.hotspots.map((h) => h.file);
        }
      } catch { /* best-effort */ }

      const report = buildChurnReport(cwd, hotspotFiles, days);

      if (report.churn.length === 0) {
        console.log(chalk.yellow('No git history found. Is this a git repository?'));
        return;
      }

      console.log(chalk.bold(`── Churn (${report.totalCommits} total commits) ─────────────────────`));
      const topChurn = report.churn.slice(0, top);
      topChurn.forEach((entry) => {
        const riskFn = RISK_COLOR[entry.risk] ?? chalk.white;
        const bar = '█'.repeat(Math.min(20, Math.ceil(entry.commits / 2)));
        console.log(
          riskFn(`  ${entry.commits.toString().padStart(3)} commits`) +
          chalk.gray(` ${entry.authors}👤 `) +
          chalk.white(entry.file) +
          chalk.dim(` ${bar}`),
        );
      });

      if (report.busFactor.length > 0) {
        console.log(chalk.bold(`\n── Bus Factor (last ${bfDays} days) ────────────────────────────`));
        console.log(chalk.gray('  Files where most commits come from a single author\n'));
        report.busFactor.slice(0, top).forEach((entry) => {
          const riskFn = RISK_COLOR[entry.risk] ?? chalk.white;
          console.log(
            riskFn(`  ${entry.primaryPercent.toString().padStart(3)}%`) +
            chalk.gray(` ${entry.totalAuthors} author${entry.totalAuthors === 1 ? '' : 's'}  `) +
            chalk.white(entry.file) +
            chalk.dim(`  (${entry.primaryAuthor})`),
          );
        });
      }

      // Risk intersection: high churn + high bus factor
      const churnHighFiles = new Set(report.churn.filter((c) => c.risk === 'critical' || c.risk === 'high').map((c) => c.file));
      const bfHighFiles = report.busFactor.filter((b) => b.risk === 'critical' || b.risk === 'high').map((b) => b.file);
      const intersection = bfHighFiles.filter((f) => churnHighFiles.has(f));

      if (intersection.length > 0) {
        console.log(chalk.bold.red(`\n⚠ HIGH RISK: High churn + single author (${intersection.length} files)`));
        intersection.forEach((f) => console.log(chalk.red(`  ${f}`)));
      }

      console.log(chalk.dim(`\nPeriod: ${days} days · ${report.totalCommits} commits · ${report.churn.length} files changed`));
    });
}
