import chalk from 'chalk';
import type { MenuItem } from './tui.js';

export type MenuAction =
  | 'audit-doctor'
  | 'connect'
  | 'change-provider'
  | 'quit'
  | 'sep';

const providerRef: { value: string } = { value: 'claude' };

export const MAIN_ITEMS: ReadonlyArray<MenuItem<MenuAction>> = [
  {
    label: '1. 🩺🐛 Audit + Doctor',
    hint: 'health check + multi-agent analysis',
    description: 'Run `aion doctor --scope all` (PIL/provider/MCP/watcher check) followed by `aion audit . --local-only` (zero-token static scan) or `--budget normal` (AI-powered, 15 domains, parallel scanners).',
    value: 'audit-doctor',
    key: '1',
  },
  {
    label: '2. 🔌 Connect',
    hint: 'install MCP · set AI provider',
    description: 'Run `aion mcp install --client <name>`. Detects installed AI clients (Cursor/Claude Desktop/Codex/OpenCode) and writes mcp.json. Also where you see which LLM provider is active.',
    value: 'connect',
    key: '2',
  },
  { label: '', value: 'sep', separator: true },
  {
    label: `Provider: ${chalk.cyan(providerRef.value)} — change`,
    hint: 'switch AI provider',
    description: 'Cycle through claude / openrouter / kimi / minimax / codex. The provider is used by Audit (AI mode) and Chat (when invoked via CLI). Persisted to `.aionrc.json`.',
    value: 'change-provider',
    key: 'p',
  },
  { label: '', value: 'sep', separator: true },
  { label: 'q. Quit', value: 'quit', key: 'q' },
];

export function setMenuProvider(name: string): void {
  providerRef.value = name;
}

export function buildMainItems(provider: string): typeof MAIN_ITEMS {
  setMenuProvider(provider);
  return [...MAIN_ITEMS];
}