import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { selectOne, printHeader } from './tui.js';
import { buildMainItems, MAIN_ITEMS } from './menu-items.js';
import type { MenuItem } from './tui.js';
import { displayProjectName } from '../infra/project-name.js';

export type { MenuItem };
export { MAIN_ITEMS } from './menu-items.js';

function resetTty(): void {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode!(false);
    process.stdout.write('\x1b[?25h');
  } catch { /* ok */ }
}

function drainStdin(): void {
  try {
    process.stdin.resume();
    let chunk;
    while ((chunk = process.stdin.read()) !== null) { void chunk; }
  } catch { /* ok */ }
}

function run(args: string[]): void {
  resetTty();
  const displayArgs = args.filter((a, i) => a !== '--cwd' && args[i - 1] !== '--cwd');
  console.log(chalk.dim(`\n  ⏳ aion ${displayArgs.join(' ')}  (Ctrl+C to cancel)\n`));
  const result = spawnSync(process.execPath, [process.argv[1]!, ...args], {
    stdio: 'inherit', env: process.env,
  });
  resetTty();
  drainStdin();
  if (result.error) console.error(chalk.red(result.error.message));
  if (!result.error && result.status !== 0) {
    console.error(chalk.red(`\n  ⚠ Command failed with status ${result.status}`));
  }
}

export function runMenuFallback(cwd: string): void {
  const projectName = displayProjectName(cwd);
  console.log('');
  console.log(chalk.bold.cyan(`  aion — ${projectName}`));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  console.log(chalk.dim('  Run in an interactive terminal to access the menu.'));
  console.log('');
  console.log(chalk.bold('  1. ') + chalk.cyan('aion doctor') + chalk.dim('  # health check'));
  console.log(chalk.bold('     ') + chalk.cyan('aion audit . --local-only') + chalk.dim('  # zero-token scan'));
  console.log(chalk.bold('  2. ') + chalk.cyan('aion mcp install --client <name>') + chalk.dim('  # connect AI client'));
  console.log('');
  console.log(chalk.dim('  Or run ') + chalk.cyan('aion --tldr') + chalk.dim(' for all 8 commands.'));
}

function statusBar(provider: string, project: string): string {
  return `  ${chalk.dim('project:')} ${chalk.cyan(project)}   ${chalk.dim('provider:')} ${chalk.cyan(provider)}   ${chalk.dim('status:')} ${chalk.green('●ready')}`;
}

async function promptAuditMode(cwd: string): Promise<void> {
  const mode = await selectOne('Audit mode', [
    { label: '🧪 Local-only', hint: 'zero token · static scan only · ~10s', value: 'local' },
    { label: '🤖 AI-powered', hint: 'uses provider · 15 domains · ~2-7min', value: 'ai' },
    { label: '— back —', value: '__back__' },
  ]);
  if (!mode || mode === '__back__') return;
  if (mode === 'local') {
    run(['--cwd', cwd, 'audit', '.', '--local-only']);
  } else {
    run(['--cwd', cwd, 'audit', '.', '--budget', 'normal']);
  }
}

async function promptConnect(cwd: string): Promise<void> {
  const choice = await selectOne('Install MCP for which client?', [
    { label: 'Cursor', hint: 'writes .cursor/mcp.json', value: 'cursor' },
    { label: 'Claude Desktop', hint: 'writes ~/.claude/mcp.json', value: 'claude' },
    { label: 'Codex CLI', hint: 'writes ~/.codex/config.toml', value: 'codex' },
    { label: 'OpenCode', hint: 'writes ~/.config/opencode/opencode.json', value: 'opencode' },
    { label: 'All (try each)', value: 'all' },
    { label: '— back —', value: '__back__' },
  ]);
  if (!choice || choice === '__back__') return;
  run(['--cwd', cwd, 'mcp', 'install', '--client', choice]);
}

export async function runMenu(cwd: string): Promise<void> {
  if (!process.stdin.isTTY) { runMenuFallback(cwd); return; }

  const { loadAionConfig } = await import('../infra/aion-config.js');
  const aionConfig = loadAionConfig(cwd);
  let currentProvider: string = aionConfig.provider ?? 'claude';

  const projectName = displayProjectName(cwd);
  const items = buildMainItems(currentProvider);

  while (true) {
    console.log('');
    printHeader(projectName, '');
    console.log(statusBar(currentProvider, projectName));

    const action = await selectOne('What do you want to do?', [...items]);
    if (!action || action === 'quit') break;
    if (action === 'sep') continue;

    if (action === 'change-provider') {
      const picked = await selectOne('Select AI provider', [
        { label: 'claude',      hint: 'recommended — requires ANTHROPIC_API_KEY', value: 'claude' },
        { label: 'openrouter',  hint: 'requires OPENROUTER_API_KEY', value: 'openrouter' },
        { label: 'kimi',        hint: 'requires MOONSHOT_API_KEY', value: 'kimi' },
        { label: 'minimax',     hint: 'requires MINIMAX_API_KEY', value: 'minimax' },
        { label: 'codex',       hint: 'requires OPENAI_API_KEY', value: 'codex' },
      ]);
      if (picked) {
        currentProvider = picked;
        buildMainItems(currentProvider);
        run(['--cwd', cwd, 'providers']);
      }
      continue;
    }

    if (action === 'audit-doctor') {
      run(['--cwd', cwd, 'doctor']);
      await promptAuditMode(cwd);
      continue;
    }

    if (action === 'connect') {
      await promptConnect(cwd);
      continue;
    }
  }

  console.log(chalk.dim('\nBye!\n'));
}

import { createInterface } from 'readline';

async function promptLine(question: string): Promise<string | null> {
  resetTty();
  drainStdin();
  return new Promise<string | null>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const onSigint = () => { rl.close(); process.removeListener('SIGINT', onSigint); resolve(null); };
    process.once('SIGINT', onSigint);
    rl.question(chalk.cyan(`  ${question}: `), (ans) => {
      process.removeListener('SIGINT', onSigint);
      rl.close();
      resolve(ans.trim());
    });
  });
}