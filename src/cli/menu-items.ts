import chalk from 'chalk';
import type { MenuItem } from './tui.js';

export type MenuAction =
  | 'doctor'
  | 'sync'
  | 'find'
  | 'audit'
  | 'chat'
  | 'wiki'
  | 'mcp-install'
  | 'next'
  | 'change-provider'
  | 'help'
  | 'quit'
  | 'sep';

const providerRef: { value: string } = { value: 'claude' };

export const MAIN_ITEMS: ReadonlyArray<MenuItem<MenuAction>> = [
  { label: 'Quick check', header: true, value: 'sep' },
  {
    label: '1. 🩺 Doctor — health check',
    hint: 'zero token · ~2s',
    description: 'Run `aion doctor --scope all`. Checks PIL, provider keys, MCP wiring, file watcher. Shows pass/fail per subsystem.',
    value: 'doctor',
    key: '1',
  },
  { label: '', value: 'sep', separator: true },

  { label: 'Index', header: true, value: 'sep' },
  {
    label: '2. ⚡ Sync — build the PIL',
    hint: 'one-time per project · ~30s for 10k files',
    description: 'Run `aion sync`. Walks the codebase, builds the Project Intelligence Layer (manifest.json + vectors.bin + bm25.bin). Required before RAG works.',
    value: 'sync',
    key: '2',
  },
  {
    label: '3. 🔍 Find — search the codebase',
    hint: 'uses PIL · 99% token savings vs raw Read',
    description: 'Run `aion find <query>`. Symbol search by default; `--mode semantic` for vector search, `--mode hotspots` for risk-ranked files.',
    value: 'find',
    key: '3',
  },
  { label: '', value: 'sep', separator: true },

  { label: 'Analyze', header: true, value: 'sep' },
  {
    label: '4. 🐛 Audit — multi-agent review',
    hint: 'optional AI · scanners run in parallel',
    description: 'Run `aion audit . --local-only` for zero-token baseline, or `--budget normal` for AI-powered findings. 15 domains, ~2-7min wallclock.',
    value: 'audit',
    key: '4',
  },
  {
    label: '5. 💬 Chat — interactive Q&A',
    hint: 'uses AI · /search slash for RAG lookups',
    description: 'Run `aion chat`. Interactive REPL with codebase context. Use `/search <query>` for semantic search via PIL.',
    value: 'chat',
    key: '5',
  },
  {
    label: '6. 📋 Wiki — generate PROJECT.md',
    hint: 'zero-token docs · ~5s',
    description: 'Run `aion wiki --all`. Generates PROJECT.md + 6 domain docs in `.ai-runtime/docs/`. RAG-friendly markdown.',
    value: 'wiki',
    key: '6',
  },
  { label: '', value: 'sep', separator: true },

  { label: 'Connect', header: true, value: 'sep' },
  {
    label: '7. 🔌 MCP install — connect to AI client',
    hint: 'one-time · writes client config',
    description: 'Run `aion mcp install --client <name>`. Supports Cursor, Claude Desktop, Codex CLI, OpenCode. Writes mcp.json/config.toml in the right place.',
    value: 'mcp-install',
    key: '7',
  },
  {
    label: '8. ➡️  Next — recommended step',
    hint: 'zero token · context-aware',
    description: 'Run `aion next`. Inspects PIL state, last audit, MCP wiring; recommends the single most valuable next command.',
    value: 'next',
    key: '8',
  },
  { label: '', value: 'sep', separator: true },

  { label: '?', header: true, value: 'sep' },
  {
    label: '? — help / list all 8 commands',
    hint: 'zero token',
    description: 'Run `aion --tldr`. Shows the gateway command overview outside the menu.',
    value: 'help',
    key: '?',
  },
  { label: '', value: 'sep', separator: true },

  {
    label: `Provider: ${chalk.cyan(providerRef.value ?? 'claude')} — change`,
    hint: 'switch AI provider',
    description: 'Cycle through claude / openrouter / kimi / minimax / codex. Persisted to `.aionrc.json`.',
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