import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Create .aionrc.json and .aionignore starter files in the current project')
    .option('--force', 'overwrite existing files')
    .action(async (options: { force?: boolean }) => {
      const cwd = process.cwd();
      const { writeDefaultConfig } = await import('../../infra/aion-config.js');

      const rcPath = join(cwd, '.aionrc.json');
      const ignorePath = join(cwd, '.aionignore');

      if (existsSync(rcPath) && !options.force) {
        console.log(chalk.yellow(`  .aionrc.json already exists — use --force to overwrite`));
      } else {
        writeDefaultConfig(cwd);
        console.log(chalk.green(`  ✓ .aionrc.json created`));
      }

      if (existsSync(ignorePath) && !options.force) {
        console.log(chalk.yellow(`  .aionignore already exists — use --force to overwrite`));
      } else {
        const { writeFileSync } = await import('fs');
        writeFileSync(ignorePath, [
          '# aion ignore patterns (glob syntax)',
          '# Files matching these patterns are skipped during audit',
          '',
          '# Generated files',
          '*.generated.*',
          '*.pb.ts',
          '*.pb.js',
          '',
          '# Test fixtures & mocks',
          'fixtures/**',
          'testdata/**',
          '__mocks__/**',
          '',
          '# Vendored / third-party',
          'vendor/**',
          'third_party/**',
          '',
        ].join('\n'), 'utf8');
        console.log(chalk.green(`  ✓ .aionignore created`));
      }

      console.log('');
      console.log(chalk.dim(`  Edit .aionrc.json to set default preset, budget, and provider.`));
      console.log(chalk.dim(`  Edit .aionignore to add project-specific exclusion patterns.`));
    });
}
