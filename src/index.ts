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
import { registerDeepEval } from './cli/commands/deepeval.js';
import { registerTrace } from './cli/commands/trace.js';
import { registerMcp } from './cli/commands/mcp.js';
import { registerImpactLocal } from './cli/commands/impact-local.js';
import { registerDocs } from './cli/commands/docs.js';
import { registerCloud } from './cli/commands/cloud.js';
import { registerDeploy } from './cli/commands/deploy.js';
import { registerSetup, runProjectSetupWizard } from './cli/commands/setup.js';
import { registerCopilot } from './cli/commands/copilot.js';
import { registerIndex } from './cli/commands/index.js';
import { registerReleaseCheck } from './cli/commands/release-check.js';
import { registerWatch } from './cli/commands/watch.js';
import { registerDoctor } from './cli/commands/doctor.js';
import { registerProviders } from './cli/commands/providers.js';
import { buildAssistPlan, saveAssistPlan } from './infra/assist/assist-plan.js';
import { applyArtifacts, formatArtifactSummary } from './infra/assist/apply-artifacts.js';
import { runNaturalLanguage, runInteractive } from './cli/interactive.js';
import { runMenu } from './cli/menu.js';
import { shouldRunInitialWizard } from './infra/setup/project-setup.js';

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
      if (shouldRunInitialWizard(process.cwd(), Boolean(process.stdin.isTTY))) {
        await runProjectSetupWizard(process.cwd());
      }
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
registerDeepEval(program);
registerTrace(program);
registerMcp(program);
registerImpactLocal(program);
registerDocs(program);
registerCloud(program);
registerDeploy(program);
registerSetup(program);
registerCopilot(program);
registerIndex(program);
registerReleaseCheck(program);
registerWatch(program);
registerDoctor(program);
registerProviders(program);

program
  .command('assist')
  .description('Assisted setup for CI, tests, deploy workflows, Nginx, and healthchecks')
  .option('--apply', 'write generated artifacts')
  .option('--overwrite', 'overwrite existing artifact files')
  .option('--domain <domain>', 'deployment domain')
  .option('--port <port>', 'application port')
  .option('--deploy-path <path>', 'remote deployment path')
  .action((options: { apply?: boolean; overwrite?: boolean; domain?: string; port?: string; deployPath?: string }) => {
    const port = options.port ? Number(options.port) : undefined;
    const plan = buildAssistPlan(process.cwd(), {
      mode: 'full',
      domain: options.domain,
      appPort: Number.isInteger(port) ? port : undefined,
      deployPath: options.deployPath,
    });
    const path = saveAssistPlan(process.cwd(), plan);
    const result = applyArtifacts(process.cwd(), plan, { dryRun: !options.apply, overwrite: options.overwrite });
    process.stdout.write(`Assist plan: ${path}\n`);
    process.stdout.write(formatArtifactSummary(result) + '\n');
    if (!options.apply) process.stdout.write('Dry-run only. Re-run with --apply to write files.\n');
  });

// Explicit menu command
program
  .command('menu')
  .description('Interactive menu to select commands and personas')
  .action(async () => { await runMenu(process.cwd()); });

program.parse(process.argv);
