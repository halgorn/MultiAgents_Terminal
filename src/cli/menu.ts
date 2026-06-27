import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { selectOne, printHeader } from './tui.js';
import { buildMainItems, MAIN_ITEMS } from './menu-items.js';
export { MAIN_ITEMS } from './menu-items.js';
import type { MenuItem } from './tui.js';
import { displayProjectName } from '../infra/project-name.js';

export type { MenuItem };
export const MAIN_MENU_ITEMS = MAIN_ITEMS;

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
  console.log(chalk.bold('  1. ') + chalk.cyan('aion init') + chalk.dim('     # first-time setup'));
  console.log(chalk.bold('  2. ') + chalk.cyan('aion sync') + chalk.dim('     # build the PIL'));
  console.log(chalk.bold('  3. ') + chalk.cyan('aion mcp install --client cursor'));
  console.log(chalk.bold('  4. ') + chalk.cyan('aion find "<query>" --mode semantic'));
  console.log(chalk.bold('  5. ') + chalk.cyan('aion chat'));
  console.log(chalk.bold('  6. ') + chalk.cyan('aion audit . --local-only'));
  console.log(chalk.bold('  7. ') + chalk.cyan('aion wiki --all'));
  console.log(chalk.bold('  8. ') + chalk.cyan('aion doctor --scope all'));
  console.log('');
  console.log(chalk.dim('  Or run ') + chalk.cyan('aion --tldr') + chalk.dim(' outside the menu.'));
}

function statusBar(provider: string, project: string): string {
  const ready = chalk.green('●ready');
  return `  ${chalk.dim('project:')} ${chalk.cyan(project)}   ${chalk.dim('provider:')} ${chalk.cyan(provider)}   ${chalk.dim('status:')} ${ready}`;
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

    if (action === 'help') {
      run(['--cwd', cwd, '--tldr']);
      continue;
    }

    if (action === 'change-provider') {
      const picked = await selectOne('Select AI provider', [
        { label: 'claude',      value: 'claude' },
        { label: 'minimax',     value: 'minimax' },
        { label: 'kimi',        value: 'kimi' },
        { label: 'openrouter',  value: 'openrouter' },
        { label: 'codex',       value: 'codex' },
      ]);
      if (picked) {
        currentProvider = picked;
        buildMainItems(currentProvider);
        run(['--cwd', cwd, 'providers']);
      }
      continue;
    }

    if (action === 'doctor') {
      run(['--cwd', cwd, 'doctor', '--scope', 'all']);
      continue;
    }
    if (action === 'sync') {
      run(['--cwd', cwd, 'sync']);
      continue;
    }
    if (action === 'find') {
      const q = (await promptLine('Search query (e.g. "auth middleware")')) ?? '';
      if (q.trim()) {
        run(['--cwd', cwd, 'find', q, '--mode', 'semantic']);
      }
      continue;
    }
    if (action === 'audit') {
      run(['--cwd', cwd, 'audit', '.', '--local-only']);
      continue;
    }
    if (action === 'chat') {
      run(['--cwd', cwd, 'chat']);
      continue;
    }
    if (action === 'wiki') {
      run(['--cwd', cwd, 'wiki', '--refresh']);
      continue;
    }
    if (action === 'mcp-install') {
      const picked = await selectOne('Install MCP for which client?', [
        { label: 'Cursor', value: 'cursor' },
        { label: 'Claude Desktop', value: 'claude' },
        { label: 'Codex CLI', value: 'codex' },
        { label: 'OpenCode', value: 'opencode' },
        { label: 'All (try each)', value: 'all' },
      ]);
      if (picked) {
        run(['--cwd', cwd, 'mcp', 'install', '--client', picked]);
      }
      continue;
    }
    if (action === 'next') {
      run(['--cwd', cwd, 'next']);
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