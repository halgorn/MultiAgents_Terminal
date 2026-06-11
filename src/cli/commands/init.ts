import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import { AION_CONFIG_FILE, AION_IGNORE_FILE } from '../../infra/paths.js';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Create .aionrc.json and .aionignore starter files in the current project')
    .option('--force', 'overwrite existing files')
    .action(async (options: { force?: boolean }) => {
      const cwd = process.cwd();
      const { writeDefaultConfig } = await import('../../infra/aion-config.js');

      const rcPath = join(cwd, AION_CONFIG_FILE);
      const ignorePath = join(cwd, AION_IGNORE_FILE);

      if (existsSync(rcPath) && !options.force) {
        console.log(chalk.yellow(`  ${AION_CONFIG_FILE} already exists — use --force to overwrite`));
      } else {
        writeDefaultConfig(cwd);
        console.log(chalk.green(`  ✓ ${AION_CONFIG_FILE} created`));
      }

      if (existsSync(ignorePath) && !options.force) {
        console.log(chalk.yellow(`  ${AION_IGNORE_FILE} already exists — use --force to overwrite`));
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
        console.log(chalk.green(`  ✓ ${AION_IGNORE_FILE} created`));
      }

      console.log('');
      console.log(chalk.dim(`  Edit ${AION_CONFIG_FILE} to set default preset, budget, and provider.`));
      console.log(chalk.dim(`  Edit ${AION_IGNORE_FILE} to add project-specific exclusion patterns.`));
    });
}
