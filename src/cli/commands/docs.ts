import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { analyzeProjectDocs } from '../../infra/docs-analyzer.js';

export function registerDocs(program: Command): void {
  const docs = program
    .command('docs')
    .description('Documentation analysis and generation');

  // ── aion docs analyze ─────────────────────────────────────────────────────
  docs
    .command('analyze')
    .description('Zero-token analysis of documentation gaps in this project')
    .option('--json', 'output as JSON')
    .action((options: { json?: boolean }) => {
      const cwd = process.cwd();
      const spinner = ora('Analyzing documentation...').start();
      const report = analyzeProjectDocs(cwd);
      spinner.stop();

      if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }

      const grade = report.score >= 80 ? chalk.green : report.score >= 50 ? chalk.yellow : chalk.red;
      console.log(chalk.bold(`\nDocumentation score: ${grade(report.score + '/100')}`));
      console.log(chalk.gray(`  ${report.summary}\n`));

      if (report.existingDocs.length > 0) {
        console.log(chalk.bold('Found:'));
        report.existingDocs.forEach((f) => console.log(chalk.green(`  ✓ ${f}`)));
        console.log();
      }

      if (report.gaps.length === 0) {
        console.log(chalk.green('No documentation gaps found.'));
        return;
      }

      const bySeverity = { high: report.gaps.filter((g) => g.severity === 'high'),
        medium: report.gaps.filter((g) => g.severity === 'medium'),
        low: report.gaps.filter((g) => g.severity === 'low') };

      for (const [sev, gaps] of Object.entries(bySeverity)) {
        if (gaps.length === 0) continue;
        const color = sev === 'high' ? chalk.red : sev === 'medium' ? chalk.yellow : chalk.gray;
        console.log(color.bold(`${sev.toUpperCase()} (${gaps.length})`));
        gaps.forEach((g) => {
          console.log(color(`  ✗ ${g.description}`));
          console.log(chalk.gray(`    → ${g.suggestion}`));
        });
        console.log();
      }

      console.log(chalk.gray('  Run `aion docs generate` to auto-generate missing documentation.'));
    });

  // ── aion docs generate ────────────────────────────────────────────────────
  docs
    .command('generate')
    .description('AI-powered generation of missing documentation')
    .option('--only <type>', 'readme | changelog | contributing | docstrings | all (default: all)', 'all')
    .option('--dry-run', 'show what would be generated without writing files')
    .action(async (options: { only: string; dryRun?: boolean }) => {
      const cwd = process.cwd();
      const spinner = ora('Analyzing gaps...').start();
      const report = analyzeProjectDocs(cwd);
      spinner.stop();

      if (report.gaps.length === 0) {
        console.log(chalk.green('No documentation gaps to generate.'));
        return;
      }

      const targets = report.gaps.filter((g) => {
        if (options.only === 'all') return g.severity !== 'low';
        if (options.only === 'readme') return g.file === 'README.md';
        if (options.only === 'changelog') return g.file === 'CHANGELOG.md';
        if (options.only === 'contributing') return g.file === 'CONTRIBUTING.md';
        if (options.only === 'docstrings') return g.type === 'missing-docstring';
        return true;
      });

      if (targets.length === 0) {
        console.log(chalk.gray(`No gaps match --only ${options.only}`));
        return;
      }

      console.log(chalk.bold(`\nWill generate ${targets.length} documentation items:\n`));
      targets.forEach((g) => {
        const sev = g.severity === 'high' ? chalk.red : g.severity === 'medium' ? chalk.yellow : chalk.gray;
        console.log(`  ${sev('●')} ${g.description}`);
        console.log(chalk.gray(`    ${g.suggestion}`));
      });

      if (options.dryRun) {
        console.log(chalk.gray('\n  --dry-run: no files written.'));
        return;
      }

      // Spawn explain agent for each gap (uses existing AI pipeline)
      const { spawnSync } = await import('child_process');
      for (const gap of targets) {
        if (gap.type === 'missing-file') {
          console.log(chalk.cyan(`\nGenerating ${gap.file}...`));
          const result = spawnSync(process.execPath, [process.argv[1]!, '--cwd', cwd, 'onboard', '--output', gap.file ?? 'README.md'], {
            stdio: 'inherit', env: process.env,
          });
          if (result.error) console.error(chalk.red(`  Failed: ${result.error.message}`));
        } else if (gap.type === 'missing-docstring' && gap.file) {
          console.log(chalk.cyan(`\nGenerating docstrings for ${gap.file}...`));
          const result = spawnSync(process.execPath, [process.argv[1]!, '--cwd', cwd, 'explain', gap.file], {
            stdio: 'inherit', env: process.env,
          });
          if (result.error) console.error(chalk.red(`  Failed: ${result.error.message}`));
        }
      }

      console.log(chalk.green('\nDone. Review generated files before committing.'));
    });
}
