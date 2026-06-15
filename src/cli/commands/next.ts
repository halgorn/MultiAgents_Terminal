import type { Command } from 'commander';
import chalk from 'chalk';
import { displayProjectName } from '../../infra/project-name.js';
import { latestAuditPointer } from '../../infra/project-report.js';
import { isProjectPrepared, detectRagTrainingStatus } from '../../infra/setup/project-setup.js';

function hasLatestAudit(cwd: string): boolean {
  return latestAuditPointer(cwd) !== null;
}

function latestAiContext(cwd: string): string | undefined {
  return latestAuditPointer(cwd)?.aiContext;
}

function step(n: number, cmd: string, note?: string): void {
  const suffix = note ? chalk.dim(`  # ${note}`) : '';
  console.log(`  ${chalk.dim(String(n) + '.')} ${chalk.cyan(cmd)}${suffix}`);
}

export function registerNext(program: Command): void {
  program
    .command('next')
    .description('Show the recommended next steps based on current project state')
    .action(() => {
      const cwd = process.cwd();
      const project = displayProjectName(cwd);
      const prepared = isProjectPrepared(cwd);
      const rag = detectRagTrainingStatus(cwd);
      const hasAudit = hasLatestAudit(cwd);

      console.log(chalk.bold.cyan(`\nNext steps for ${project}\n`));

      if (!prepared) {
        console.log(chalk.bold('Project not yet initialized:'));
        step(1, 'aion init', 'create config + update .gitignore');
        step(2, 'aion setup', 'index codebase, build memory, install git hook');
        console.log('');
        console.log(chalk.dim('  Run these two commands first, then re-run `aion next`.'));
        console.log('');
        return;
      }

      const missingRag = !rag.semanticVectorsReady;
      if (missingRag) {
        console.log(chalk.bold('Semantic memory not built yet:'));
        step(1, 'aion memory build', 'enable semantic search & context retrieval');
        console.log('');
      }

      console.log(chalk.bold('Low-token analysis flow:'));
      step(1, 'aion audit . --local-only', 'zero-token baseline: static analysis only');
      step(2, 'aion audit . --dry-run --max-files 20', 'preview which files will be scanned');
      step(3, 'aion audit . --domains security,dependencies --scanners 2 --budget normal --max-files 20');
      step(4, 'aion context --audit --budget 6000', 'compress audit into AI-ready context');
      step(5, 'aion report latest', 'open the HTML report');
      console.log('');

      if (hasAudit) {
        console.log(chalk.bold('Latest audit:'));
        console.log(`  ${chalk.green('✓')} Run ${chalk.cyan('aion report latest')} to view findings.`);
        const aiCtx = latestAiContext(cwd);
        if (aiCtx) {
          console.log(`  ${chalk.dim('AI context file:')} ${chalk.cyan(aiCtx)}`);
          console.log(chalk.dim('    Paste the file path into your AI assistant to load audit context.'));
        }
      } else {
        console.log(chalk.bold('No audit yet:'));
        console.log(`  Start with ${chalk.cyan('aion audit . --local-only')} for a zero-token baseline.`);
      }

      console.log('');
      console.log(chalk.bold('Explore without AI tokens:'));
      step(1, 'aion tree --hotspots --rebuild', 'dependency graph + complexity hotspots');
      step(2, 'aion search "<topic>" --semantic --rebuild', 'semantic codebase search');
      console.log('');
    });
}
