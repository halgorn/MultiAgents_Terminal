#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import { resolve } from 'path';
import { existsSync, statSync } from 'fs';
import { runMigrations } from './infra/db/migrations.js';
import { registerAnalyze } from './cli/commands/analyze.js';
import { registerFix } from './cli/commands/fix.js';
import { registerReview } from './cli/commands/review.js';
import { registerMemory } from './cli/commands/memory.js';
import { registerAudit } from './cli/commands/audit.js';
import { registerGraph } from './cli/commands/graph.js';
import { registerChurn } from './cli/commands/churn.js';
import { registerScan } from './cli/commands/scan.js';
import { registerPatterns } from './cli/commands/patterns.js';
import { registerHealth } from './cli/commands/health.js';
import { registerReport } from './cli/commands/report.js';
import { registerExplain } from './cli/commands/explain.js';
import { registerInit } from './cli/commands/init.js';
import { runNaturalLanguage, runInteractive } from './cli/interactive.js';
import { runMenu } from './cli/menu.js';

runMigrations();

program
  .name('ai')
  .description('Multi-agent AI engineering runtime')
  .version('0.2.1')
  .option('-C, --cwd <path>', 'working directory (defaults to current directory)')
  .argument('[request...]', 'natural language request (e.g. "corrija o bug de login")')
  .action(async (requestWords: string[]) => {
    const opts = program.opts() as { cwd?: string };
    if (opts.cwd) {
      const dir = resolve(opts.cwd);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        console.error(`error: directory not found: ${dir}`);
        process.exit(1);
      }
      process.chdir(dir);
    }

    if (requestWords.length === 0) {
      // No args → always try menu first; falls back to NL REPL if no TTY
      await runMenu(process.cwd());
    } else {
      await runNaturalLanguage(requestWords.join(' '), process.cwd());
    }
  });

program.hook('preSubcommand', (thisCommand) => {
  const opts = thisCommand.opts() as { cwd?: string };
  if (opts.cwd) {
    const dir = resolve(opts.cwd);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      console.error(`error: directory not found: ${dir}`);
      process.exit(1);
    }
    process.chdir(dir);
  }
});

registerAnalyze(program);
registerFix(program);
registerReview(program);
registerMemory(program);
registerAudit(program);
registerGraph(program);
registerChurn(program);
registerScan(program);
registerPatterns(program);
registerHealth(program);
registerReport(program);
registerExplain(program);
registerInit(program);

// Explicit menu command
program
  .command('menu')
  .description('Interactive menu to select commands and personas')
  .action(async () => { await runMenu(process.cwd()); });

program.parse(process.argv);
