import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { buildDepGraphAuto } from '../../infra/dep-graph.js';
import { saveDepGraph, loadDepGraph, computeImpact, formatImpactReport } from '../../infra/dep-graph-db.js';
import { collectAuditStats, prioritizeFiles } from '../../core/pipelines/audit-file-scanner.js';

export function registerImpactLocal(program: Command): void {
  program
    .command('impact-local <file>')
    .description('Zero-token impact analysis: which files break if you change this file')
    .option('--rebuild', 'force rebuild of cached dependency graph')
    .option('--json', 'output results as JSON')
    .action((file: string, options: { rebuild?: boolean; json?: boolean }) => {
      const cwd = process.cwd();
      const spinner = ora('Loading dependency graph...').start();

      let stored = options.rebuild ? null : loadDepGraph(cwd);

      if (!stored) {
        spinner.text = 'Building dependency graph (first run, takes ~5s)...';
        const graph = buildDepGraphAuto(cwd);
        saveDepGraph(cwd, graph);
        stored = loadDepGraph(cwd)!;
        spinner.text = `Graph built: ${graph.nodes.size} modules`;
      }

      // Get hotspot files for overlap detection
      spinner.text = 'Computing impact...';
      const stats = collectAuditStats(cwd, '.');
      const hotspots = prioritizeFiles(cwd, stats.auditFiles, 20);

      // Normalize file path — accept both relative and with cwd prefix
      const normalizedFile = file.replace(/^\.\//, '');
      const result = computeImpact(stored, normalizedFile, hotspots);

      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.totalImpact === 0) {
        console.log(chalk.green(`\n  ${normalizedFile} has no dependents — safe to change.`));
        return;
      }

      const riskColor = result.totalImpact > 20 ? chalk.red : result.totalImpact > 5 ? chalk.yellow : chalk.green;
      console.log('\n' + formatImpactReport(result).split('\n').map((line) => {
        if (line.startsWith('Impact analysis:')) return chalk.bold(line);
        if (line.startsWith('Total affected:')) return riskColor(line);
        if (line.startsWith('Risk:')) return riskColor.bold(line);
        if (line.startsWith('  →')) return chalk.cyan(line);
        if (line.startsWith('  ↪')) return chalk.gray(line);
        if (line.startsWith('  ⚠')) return chalk.yellow(line);
        return chalk.gray(line);
      }).join('\n'));

      console.log(chalk.gray('\n  Tip: run `aion impact <file>` for AI-powered explanation of the impact.'));
    });
}
