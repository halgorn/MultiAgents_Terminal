import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import { displayProjectName } from '../../infra/project-name.js';
import { latestAuditPointer } from '../../infra/project-report.js';
import { isProjectPrepared, detectRagTrainingStatus } from '../../infra/setup/project-setup.js';
import { FilePilReader } from '../../infrastructure/rag/pil-reader.js';

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
      const pilExists = existsSync(join(cwd, '.ai-runtime', 'pil', 'manifest.json'));

      console.log(chalk.bold.cyan(`\nNext steps for ${project}\n`));

      if (!prepared) {
        console.log(chalk.bold('Project not yet initialized:'));
        step(1, 'aion init', 'create config + update .gitignore');
        step(2, 'aion sync', 'build the Project Intelligence Layer (PIL v2)');
        step(3, 'aion mcp install --client cursor', 'connect to your AI client');
        console.log('');
        console.log(chalk.dim('  Run these commands first, then re-run `aion next`.'));
        console.log('');
        return;
      }

      if (!pilExists) {
        console.log(chalk.bold('PIL (Project Intelligence Layer) missing:'));
        step(1, 'aion sync', 'build .ai-runtime/pil/ (RAG v2 — single source of truth)');
        step(2, 'aion wiki --all', 'generate PROJECT.md + 6 domain docs');
        console.log('');
      }

      const missingRag = !rag.semanticVectorsReady;
      if (missingRag && pilExists) {
        console.log(chalk.bold('Legacy .ai-memory/ still in use:'));
        step(1, 'aion sync', 'migrate from .ai-memory/ to PIL v2');
        console.log('');
      }

      console.log(chalk.bold('Low-token analysis flow:'));
      step(1, 'aion audit . --local-only', 'zero-token baseline: static analysis only');
      step(2, 'aion audit . --dry-run --max-files 20', 'preview which files will be scanned');
      step(3, 'aion audit . --domains security,dependencies --scanners 2 --budget normal --max-files 20');
      step(4, 'aion wiki --refresh', 'regenerate PROJECT.md with latest findings');
      step(5, 'aion doctor --scope all', 'verify PIL freshness + provider health');
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
      console.log(chalk.bold('Connect to your AI agent:'));
      step(1, 'aion mcp install --client cursor', 'or: claude, codex, opencode');
      step(2, 'aion find "auth middleware" --mode semantic', 'RAG search via PIL v2');
      step(3, 'aion chat', 'interactive codebase Q&A');
      console.log('');
    });
}
