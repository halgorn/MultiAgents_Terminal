import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { displayProjectName } from '../../infra/project-name.js';

function hasLatestAudit(cwd: string): boolean {
  return existsSync(join(cwd, '.ai-runtime', 'reports', 'latest-audit.json'));
}

function latestAiContext(cwd: string): string | undefined {
  try {
    const pointer = JSON.parse(readFileSync(join(cwd, '.ai-runtime', 'reports', 'latest-audit.json'), 'utf8')) as { aiContext?: string };
    return pointer.aiContext;
  } catch {
    return undefined;
  }
}

export function registerNext(program: Command): void {
  program
    .command('next')
    .description('Show the recommended low-token next steps for this project')
    .action(() => {
      const cwd = process.cwd();
      const project = displayProjectName(cwd);
      console.log(chalk.bold.cyan(`\nNext steps for ${project}\n`));
      console.log(chalk.bold('Low-token analysis flow:'));
      console.log(`  1. ${chalk.cyan('aion audit . --dry-run --max-files 20')}`);
      console.log(`  2. ${chalk.cyan('aion audit . --local-only')}`);
      console.log(`  3. ${chalk.cyan('aion audit . --domains security,dependencies --scanners 2 --budget normal --max-files 20')}`);
      console.log(`  4. ${chalk.cyan('aion context --audit --budget 6000')}`);
      console.log(`  5. ${chalk.cyan('aion report latest')}`);
      console.log('');
      if (hasLatestAudit(cwd)) {
        console.log(chalk.bold('Latest audit exists:'));
        console.log(`  ${chalk.green('ok')} Run ${chalk.cyan('aion report latest')} to see the right files.`);
        const aiContext = latestAiContext(cwd);
        if (aiContext) console.log(`  Send to AI: ${chalk.cyan(aiContext)}`);
      } else {
        console.log(chalk.bold('No audit found yet:'));
        console.log(`  Start with ${chalk.cyan('aion audit . --local-only')} for a zero-token baseline.`);
      }
      console.log('');
      console.log(chalk.bold('Navigation without AI tokens:'));
      console.log(`  ${chalk.cyan('aion tree --hotspots --rebuild')}`);
      console.log(`  ${chalk.cyan('aion search "audit report generation" --semantic --rebuild')}`);
      console.log('');
    });
}
