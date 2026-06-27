import chalk from 'chalk';

const DEPRECATION_LOG = new Set<string>();

export function emitDeprecation(oldCmd: string, newCmd: string, opts: { removedIn?: string; notes?: string } = {}): void {
  if (DEPRECATION_LOG.has(oldCmd)) return;
  DEPRECATION_LOG.add(oldCmd);
  const removed = opts.removedIn ?? 'v1.2';
  const lines = [
    chalk.yellow(`⚠ Deprecation: '${oldCmd}' is deprecated, use '${newCmd}'.`),
    chalk.dim(`  Removal in ${removed}.`),
  ];
  if (opts.notes) lines.push(chalk.dim(`  ${opts.notes}`));
  lines.push(chalk.dim(`  See docs/MIGRATION-V1.md for the full mapping.`));
  console.error(lines.join('\n'));
}

export const COMMAND_MIGRATIONS: Record<string, { replacement: string; removedIn?: string; notes?: string }> = {
  'setup': { replacement: 'aion init', notes: 'wizard folded into init' },
  'setup --status': { replacement: 'aion doctor', notes: 'use --json for machine output' },
  'index': { replacement: 'aion sync' },
  'memory build': { replacement: 'aion sync' },
  'memory deps': { replacement: 'aion sync' },
  'memory index': { replacement: 'aion sync' },
  'memory search': { replacement: 'aion find --mode semantic' },
  'memory query': { replacement: 'aion find --mode semantic' },
  'memory list': { replacement: 'aion find --mode symbol' },
  'search': { replacement: 'aion find --mode symbol' },
  'tree --hotspots': { replacement: 'aion find --mode hotspots' },
  'churn': { replacement: 'aion find --mode churn' },
  'ci': { replacement: 'aion audit --ci', notes: 'use audit --ci --format json for scripts' },
  'ci assist': { replacement: 'removed in v1.0', notes: 'use aion init + chat for setup' },
  'mcp doctor': { replacement: 'aion doctor --scope mcp' },
  'mcp list-tools': { replacement: 'aion mcp logs' },
  'mcp tail': { replacement: 'aion mcp logs' },
  'mcp cost': { replacement: 'aion mcp logs --cost' },
  'graph': { replacement: 'aion find --mode hotspots' },
  'health': { replacement: 'aion doctor --scope project' },
  'diff': { replacement: 'aion doctor --scope audit-diff' },
  'context': { replacement: 'aion wiki --mode context' },
  'patterns': { replacement: 'removed in v1.0', notes: 'folded into aion scan architecture' },
  'assist': { replacement: 'removed in v1.0', notes: 'use aion init or aion chat' },
  'cloud': { replacement: 'removed in v1.0' },
  'deploy': { replacement: 'removed in v1.0' },
  'deepeval': { replacement: 'removed in v1.0', notes: 'tracked as v1.x plugin' },
  'ai-runtime': { replacement: 'aion', notes: 'binary alias deprecated' },
};

export function lookupDeprecation(cmd: string) {
  return COMMAND_MIGRATIONS[cmd];
}

export const TLDR_TEXT = `${chalk.bold('aion — project gateway for code-aware AI agents')}

${chalk.dim('8 commands:')}

  ${chalk.cyan('init')}     First-time setup (provider, scope, goal)
  ${chalk.cyan('sync')}     Build/update the Project Intelligence Layer
  ${chalk.cyan('mcp')}      ${chalk.dim('install | serve | doctor | logs')}
  ${chalk.cyan('wiki')}     Generate PROJECT.md + domain docs
  ${chalk.cyan('find')}     Search ${chalk.dim('--mode symbol|semantic|hotspots|churn')}
  ${chalk.cyan('chat')}     Interactive codebase Q&A
  ${chalk.cyan('doctor')}   Health check ${chalk.dim('--scope project|mcp|all')}
  ${chalk.cyan('next')}     Recommended next step

${chalk.dim('Examples:')}
  aion init
  aion sync
  aion mcp install --client cursor
  aion find "auth middleware" --mode semantic
  aion doctor --scope all --json

${chalk.dim('Other commands are deprecated. See docs/MIGRATION-V1.md.')}
`;

export function printTldr(): void {
  console.log(TLDR_TEXT);
}