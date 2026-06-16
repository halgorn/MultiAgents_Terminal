import type { Command } from 'commander';
import chalk from 'chalk';
import { isProjectPrepared, detectRagTrainingStatus, readSetupState } from '../../infra/setup/project-setup.js';
import { isHookInstalled } from '../../infra/git-hooks.js';
import { existsSync } from 'fs';
import { join } from 'path';
import { AION_CONFIG_FILE, AION_IGNORE_FILE } from '../../infra/paths.js';
import { latestAuditPointer } from '../../infra/project-report.js';

interface CheckResult {
  label: string;
  ok: boolean;
  detail?: string;
  fix?: string;
}

function check(label: string, ok: boolean, detail?: string, fix?: string): CheckResult {
  return { label, ok, detail, fix };
}

function providerStatus(): { name: string; active: boolean; envVar: string }[] {
  return [
    { name: 'claude',      envVar: 'ANTHROPIC_API_KEY',  active: Boolean(process.env['ANTHROPIC_API_KEY']) },
    { name: 'openrouter',  envVar: 'OPENROUTER_API_KEY', active: Boolean(process.env['OPENROUTER_API_KEY']) },
    { name: 'kimi',        envVar: 'MOONSHOT_API_KEY',   active: Boolean(process.env['MOONSHOT_API_KEY']) },
    { name: 'minimax',     envVar: 'MINIMAX_API_KEY',    active: Boolean(process.env['MINIMAX_API_KEY']) },
  ];
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check project setup, providers, and memory readiness')
    .option('--json', 'output structured JSON')
    .action((options: { json?: boolean }) => {
      const cwd = process.cwd();
      const rag = detectRagTrainingStatus(cwd);
      const prepared = isProjectPrepared(cwd);
      const state = readSetupState(cwd);
      const providers = providerStatus();
      const activeProvider = providers.find((p) => p.active);

      const checks: CheckResult[] = [
        check(
          'Config file (.aionrc.json)',
          existsSync(join(cwd, AION_CONFIG_FILE)),
          undefined,
          'aion init',
        ),
        check(
          'Ignore file (.aionignore)',
          existsSync(join(cwd, AION_IGNORE_FILE)),
          undefined,
          'aion init',
        ),
        check(
          'Project setup complete',
          prepared,
          state ? `domain: ${state.selectedDomain}  budget: ${state.selectedBudget}` : undefined,
          'aion setup',
        ),
        check(
          'Repo index',
          rag.repoIndexReady,
          undefined,
          'aion memory index',
        ),
        check(
          'Semantic memory (vectors)',
          rag.semanticVectorsReady,
          undefined,
          'aion memory build',
        ),
        check(
          'Git hook (post-commit)',
          isHookInstalled(cwd),
          undefined,
          'aion setup',
        ),
        check(
          'AI provider configured',
          Boolean(activeProvider),
          activeProvider ? `${activeProvider.name} (${activeProvider.envVar})` : undefined,
          'export ANTHROPIC_API_KEY=sk-ant-...',
        ),
        check(
          'Latest audit exists',
          latestAuditPointer(cwd) !== null,
          undefined,
          'aion audit . --local-only',
        ),
      ];

      const failCount = checks.filter((c) => !c.ok).length;

      if (options.json) {
        console.log(JSON.stringify({
          passed: failCount === 0,
          failCount,
          checks: checks.map((c) => ({ label: c.label, ok: c.ok, detail: c.detail ?? null, fix: c.fix ?? null })),
        }, null, 2));
        if (failCount > 0) process.exitCode = 1;
        return;
      }

      const ok = chalk.green('✓');
      const fail = chalk.red('✗');
      const warn = chalk.yellow('!');

      console.log(chalk.bold.cyan('\naion doctor\n'));

      for (const c of checks) {
        const icon = c.ok ? ok : fail;
        const label = c.ok ? chalk.white(c.label) : chalk.red(c.label);
        const detail = c.detail ? chalk.dim(`  ${c.detail}`) : '';
        console.log(`  ${icon}  ${label}${detail}`);
        if (!c.ok && c.fix) {
          console.log(`     ${warn} fix: ${chalk.cyan(c.fix)}`);
        }
      }

      console.log('');

      if (failCount === 0) {
        console.log(chalk.green('  All checks passed. Run `aion next` for recommended next steps.'));
      } else {
        console.log(chalk.yellow(`  ${failCount} check(s) failed. Fix the issues above, then run \`aion next\`.`));
      }
      console.log('');
    });
}
