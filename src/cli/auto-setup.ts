import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { spawnSync } from 'child_process';
import {
  detectAvailableProvider,
  detectMcpClients,
  hasCompletedSetup,
  loadAionConfig,
  markSetupCompleted,
  saveAionConfig,
  type DetectedMcpClient,
} from '../infra/aion-config.js';
import { selectOne, printHeader } from './tui.js';
import { buildMainItems } from './menu-items.js';

export type SetupOutcome = 'completed' | 'skipped' | 'no-tty' | 'no-provider';

export interface SetupResult {
  outcome: SetupOutcome;
  provider?: string;
  mcpInstalledFor?: string[];
  synced: boolean;
}

function runSilent(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [process.argv[1]!, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    timeout: 300_000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

export async function autoFirstRunSetup(cwd: string): Promise<SetupResult> {
  if (!process.stdin.isTTY) return { outcome: 'no-tty', synced: false };

  const config = loadAionConfig(cwd);
  if (hasCompletedSetup(cwd)) {
    return { outcome: 'skipped', synced: false };
  }

  printHeader('Welcome to Aion', 'first-time setup · takes ~30 seconds');
  console.log('');

  let provider = config.provider;
  const detected = detectAvailableProvider();

  if (!provider) {
    if (detected) {
      provider = detected.provider;
      saveAionConfig(cwd, { provider });
      console.log(chalk.green(`  ✓ Detected ${detected.envVar} → using provider ${chalk.cyan(detected.provider)}`));
    } else {
      console.log(chalk.yellow('  ⚠ No provider API key found in environment.'));
      console.log(chalk.dim('    Set ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, MOONSHOT_API_KEY, or MINIMAX_API_KEY.'));
      console.log('');
      const picked = await selectOne('  Pick a provider (or quit to set keys first)', [
        { label: 'claude', hint: 'recommended — requires ANTHROPIC_API_KEY', value: 'claude' },
        { label: 'openrouter', hint: 'requires OPENROUTER_API_KEY', value: 'openrouter' },
        { label: 'kimi', hint: 'requires MOONSHOT_API_KEY', value: 'kimi' },
        { label: 'minimax', hint: 'requires MINIMAX_API_KEY', value: 'minimax' },
        { label: 'codex', hint: 'requires OPENAI_API_KEY', value: 'codex' },
        { label: '— quit setup —', value: '__quit__' },
      ]);
      if (!picked || picked === '__quit__') return { outcome: 'no-provider', synced: false };
      provider = picked as 'claude' | 'codex' | 'openrouter' | 'kimi' | 'minimax';
      saveAionConfig(cwd, { provider });
    }
  } else {
    console.log(chalk.green(`  ✓ Provider from .aionrc.json: ${chalk.cyan(provider)}`));
  }

  console.log(chalk.dim(`\n  Building the Project Intelligence Layer (PIL)...`));
  const syncResult = runSilent(['sync'], cwd);
  const synced = syncResult.status === 0;
  if (synced) {
    console.log(chalk.green(`  ✓ PIL built — codebase indexed`));
  } else {
    console.log(chalk.yellow(`  ⚠ sync failed (non-fatal, you can retry later)`));
  }

  const clients = detectMcpClients(cwd);
  const mcpInstalledFor: string[] = [];
  if (clients.length > 0) {
    console.log(chalk.cyan(`\n  Detected AI clients:`));
    for (const c of clients) {
      console.log(chalk.dim(`    - ${c.name} (${c.scope})`));
    }
    const picked = await selectOne('\n  Install MCP for which client?', [
      ...clients.map((c: DetectedMcpClient) => ({
        label: c.name,
        hint: `${c.scope} — ${c.path}`,
        value: c.name,
      })),
      { label: '— skip MCP for now —', value: '__skip__' },
    ]);
    if (picked && picked !== '__skip__') {
      console.log(chalk.dim(`  Installing MCP for ${picked}...`));
      const mcp = runSilent(['mcp', 'install', '--client', picked], cwd);
      if (mcp.status === 0) {
        mcpInstalledFor.push(picked);
        saveAionConfig(cwd, { mcpAutoInstalled: true });
        console.log(chalk.green(`  ✓ MCP installed for ${picked}`));
      } else {
        console.log(chalk.yellow(`  ⚠ MCP install failed for ${picked} (non-fatal)`));
      }
    }
  } else {
    console.log(chalk.dim('\n  No AI clients detected. Run `aion mcp install --client <name>` later.'));
  }

  markSetupCompleted(cwd, '1.0-alpha');
  console.log(chalk.bold.green('\n  ✓ Setup complete.\n'));

  return { outcome: 'completed', provider, mcpInstalledFor, synced };
}