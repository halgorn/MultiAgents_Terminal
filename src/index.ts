#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import { resolve } from 'path';
import { existsSync, statSync } from 'fs';
import { runMigrations } from './infra/db/migrations.js';
import { registerAnalyze } from './cli/commands/analyze.js';
import { registerFix } from './cli/commands/fix.js';
import { registerReview } from './cli/commands/review.js';

runMigrations();

program
  .name('ai')
  .description('Multi-agent AI engineering runtime')
  .version('0.1.0')
  .option('-C, --cwd <path>', 'working directory (defaults to current directory)');

program.hook('preAction', (thisCommand) => {
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

program.parse(process.argv);
