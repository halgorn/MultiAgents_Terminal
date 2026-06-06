#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import { resolve } from 'path';
import { existsSync, statSync } from 'fs';
import { checkForUpdate, getCurrentVersion } from './infra/update-check.js';
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
import { registerDiff } from './cli/commands/diff.js';
import { registerChat } from './cli/commands/chat.js';
import { registerContext } from './cli/commands/context.js';
import { registerSearch } from './cli/commands/search.js';
import { registerTree } from './cli/commands/tree.js';
import { registerNext } from './cli/commands/next.js';
import { registerCi } from './cli/commands/ci.js';
import { registerEval } from './cli/commands/eval.js';
import { registerTrace } from './cli/commands/trace.js';
import { registerMcp } from './cli/commands/mcp.js';
import { runNaturalLanguage, runInteractive } from './cli/interactive.js';
import { runMenu } from './cli/menu.js';

runMigrations();
await checkForUpdate();

program
  .name('ai')
  .description('Multi-agent AI engineering runtime')
  .version(getCurrentVersion())
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
registerDiff(program);
registerChat(program);
registerContext(program);
registerSearch(program);
registerTree(program);
registerNext(program);
registerCi(program);
registerEval(program);
registerTrace(program);
registerMcp(program);

// Explicit menu command
program
  .command('menu')
  .description('Interactive menu to select commands and personas')
  .action(async () => { await runMenu(process.cwd()); });

program.parse(process.argv);
