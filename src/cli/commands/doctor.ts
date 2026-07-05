import type { Command } from 'commander';
import chalk from 'chalk';
import { isProjectPrepared, detectRagTrainingStatus, readSetupState } from '../../infra/setup/project-setup.js';
import { isHookInstalled } from '../../infra/git-hooks.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { AION_CONFIG_FILE, AION_IGNORE_FILE } from '../../infra/paths.js';
import { latestAuditPointer } from '../../infra/project-report.js';

type Scope = 'project' | 'mcp' | 'all';

const VALID_SCOPES: ReadonlySet<Scope> = new Set(['project', 'mcp', 'all']);

interface CheckResult {
  label: string;
  ok: boolean;
  scope: Scope;
  detail?: string;
  fix?: string;
}

function check(label: string, ok: boolean, scope: Scope, detail?: string, fix?: string): CheckResult {
  return { label, ok, scope, detail, fix };
}

function providerStatus(): { name: string; active: boolean; envVar: string }[] {
  return [
    { name: 'claude',      envVar: 'ANTHROPIC_API_KEY',  active: Boolean(process.env['ANTHROPIC_API_KEY']) },
    { name: 'openrouter',  envVar: 'OPENROUTER_API_KEY', active: Boolean(process.env['OPENROUTER_API_KEY']) },
    { name: 'kimi',        envVar: 'MOONSHOT_API_KEY',   active: Boolean(process.env['MOONSHOT_API_KEY']) },
    { name: 'minimax',     envVar: 'MINIMAX_API_KEY',    active: Boolean(process.env['MINIMAX_API_KEY']) },
  ];
}

function mcpChecks(cwd: string): CheckResult[] {
  const mcpPath = join(cwd, '.mcp.json');
  const installed = existsSync(mcpPath);
  const servers: string[] = [];
  if (installed) {
    try {
      const raw = JSON.parse(readFileSync(mcpPath, 'utf8')) as { mcpServers?: Record<string, unknown> };
      if (raw.mcpServers && typeof raw.mcpServers === 'object') {
        for (const name of Object.keys(raw.mcpServers)) servers.push(name);
      }
    } catch { /* unparseable mcp.json — flag as bad */ }
  }
  const checks: CheckResult[] = [
    check('MCP config (.mcp.json)', installed, 'mcp', undefined, 'aion mcp install --client <name>'),
  ];
  for (const name of servers) {
    checks.push(check(`MCP server: ${name}`, true, 'mcp'));
  }
  return checks;
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check project setup, providers, and memory readiness')
    .option('--json', 'output structured JSON')
    .option('--scope <scope>', 'project | mcp | all (default: all)', 'all')
    .action((options: { json?: boolean; scope?: string }) => {
      const rawScope = (options.scope ?? 'all').toLowerCase();
      const scope: Scope = VALID_SCOPES.has(rawScope as Scope) ? (rawScope as Scope) : 'all';
      if (scope !== 'all' && rawScope !== scope) {
        console.error(chalk.yellow(`  Unknown scope "${rawScope}" — falling back to "all"`));
      }

      const cwd = process.cwd();
      const rag = detectRagTrainingStatus(cwd);
      const prepared = isProjectPrepared(cwd);
      const state = readSetupState(cwd);
      const providers = providerStatus();
      const activeProvider = providers.find((p) => p.active);

      const projectChecks: CheckResult[] = [
        check(
          'Config file (.aionrc.json)',
          existsSync(join(cwd, AION_CONFIG_FILE)),
          'project',
          undefined,
          'aion init',
        ),
        check(
          'Ignore file (.aionignore)',
          existsSync(join(cwd, AION_IGNORE_FILE)),
          'project',
          undefined,
          'aion init',
        ),
        check(
          'Project setup complete',
          prepared,
          'project',
          state ? `domain: ${state.selectedDomain}  budget: ${state.selectedBudget}` : undefined,
          'aion setup',
        ),
        check(
          'Repo index',
          rag.repoIndexReady,
          'project',
          undefined,
          'aion memory index',
        ),
        check(
          'Semantic memory (vectors)',
          rag.semanticVectorsReady,
          'project',
          undefined,
          'aion memory build',
        ),
        check(
          'Git hook (post-commit)',
          isHookInstalled(cwd),
          'project',
          undefined,
          'aion setup',
        ),
        check(
          'AI provider configured',
          Boolean(activeProvider),
          'project',
          activeProvider ? `${activeProvider.name} (${activeProvider.envVar})` : undefined,
          'export ANTHROPIC_API_KEY=sk-ant-...',
        ),
        check(
          'Latest audit exists',
          latestAuditPointer(cwd) !== null,
          'project',
          undefined,
          'aion audit . --local-only',
        ),
      ];

      const allChecks: CheckResult[] =
        scope === 'project' ? projectChecks
        : scope === 'mcp' ? mcpChecks(cwd)
        : [...projectChecks, ...mcpChecks(cwd)];

      const failCount = allChecks.filter((c) => !c.ok).length;

      if (options.json) {
        console.log(JSON.stringify({
          scope,
          passed: failCount === 0,
          failCount,
          checks: allChecks.map((c) => ({ label: c.label, ok: c.ok, scope: c.scope, detail: c.detail ?? null, fix: c.fix ?? null })),
        }, null, 2));
        if (failCount > 0) process.exitCode = 1;
        return;
      }

      const ok = chalk.green('✓');
      const fail = chalk.red('✗');
      const warn = chalk.yellow('!');

      console.log(chalk.bold.cyan(`\naion doctor — scope: ${scope}\n`));

      for (const c of allChecks) {
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
