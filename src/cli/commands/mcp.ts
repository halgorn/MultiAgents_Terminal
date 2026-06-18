import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  installClient,
  doctorCheck,
  defaultBinPath,
  defaultServerArgs,
  type ClientName,
} from '../../mcp/install.js';
import { createRotatingLog } from '../../mcp/log-file.js';
import { observabilitySummary, recentEntries } from '../../mcp/observability.js';

function defaultMcpCwd(): string {
  return process.cwd();
}

function readClaudeConfig(): { servers: Record<string, unknown> } | null {
  const path = join(homedir(), '.claude', 'mcp.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers?: Record<string, unknown> };
    return { servers: parsed.mcpServers ?? {} };
  } catch {
    return null;
  }
}

function startTailing(logPath: string, sinceArg?: string): void {
  const log = createRotatingLog('.', logPath);
  console.log(chalk.dim(`  tailing ${logPath} (Ctrl+C to stop)\n`));
  const lines = sinceArg ? log.readSince(sinceArg) : log.readLastN(20);
  for (const line of lines) process.stdout.write(line + '\n');
  setInterval(() => {
    const more = log.readLastN(20);
    for (const line of more) process.stdout.write(line + '\n');
  }, 1000);
}

export function registerMcp(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('MCP server — expose aion tools to Claude Desktop, Cursor, Codex, and other AI clients');

  mcp
    .command('serve')
    .description('Start the aion MCP server (stdio transport)')
    .option('--register', 'register in ~/.claude/mcp.json for Claude Desktop auto-connect')
    .option('--no-auto-sync', 'disable auto-sync on connect')
    .option('--no-watch', 'disable background file watcher')
    .option('--token-budget <n>', 'token budget per response', '1500')
    .option('--log-file <path>', 'persistent log file path', '.ai-runtime/mcp.log')
    .option('--log-level <level>', 'log level (debug|info|warn|error)', 'info')
    .action(async (options: { register?: boolean; autoSync?: boolean; watch?: boolean; tokenBudget?: string; logFile?: string; logLevel?: string }) => {
      if (options.register) {
        const binPath = process.argv[1] ?? 'aion';
        const cfgPath = join(homedir(), '.claude', 'mcp.json');
        const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown> : {};
        const servers = (cfg['mcpServers'] ?? {}) as Record<string, unknown>;
        servers['aion'] = { command: binPath, args: ['mcp', 'serve'] };
        cfg['mcpServers'] = servers;
        const { writeFileSync, mkdirSync } = await import('fs');
        const { dirname } = await import('path');
        mkdirSync(dirname(cfgPath), { recursive: true });
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
        console.error(chalk.green(`Registered aion MCP server in ${cfgPath}`));
        console.error(chalk.gray('Restart Claude Desktop to pick up the new server.'));
      }

      const { startMcpServer } = await import('../../mcp/server.js');
      await startMcpServer({
        cwd: defaultMcpCwd(),
        autoSync: options.autoSync !== false,
        watch: options.watch !== false,
        tokenBudget: parseInt(options.tokenBudget ?? '1500', 10) || 1500,
        logFile: options.logFile ?? '.ai-runtime/mcp.log',
        logLevel: (options.logLevel as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
      });
    });

  mcp
    .command('install')
    .description('Install aion MCP config in a target client')
    .option('--client <name>', 'cursor | claude | codex | opencode | all', 'cursor')
    .option('--dry-run', 'show what would be written, no changes')
    .option('--uninstall', 'remove aion from client configs')
    .action(async (opts: { client: string; dryRun?: boolean; uninstall?: boolean }) => {
      const client = (['cursor', 'claude', 'codex', 'opencode', 'all'] as const).includes(opts.client as 'cursor' | 'claude' | 'codex' | 'opencode' | 'all')
        ? opts.client as ClientName | 'all'
        : 'cursor';
      const results = installClient({
        client,
        cwd: defaultMcpCwd(),
        binPath: defaultBinPath(),
        args: defaultServerArgs(),
        dryRun: opts.dryRun,
        uninstall: opts.uninstall,
      });
      for (const r of results) {
        const icon = r.written ? chalk.green('✓') : r.existed ? chalk.yellow('•') : chalk.gray('–');
        console.log(`  ${icon} ${chalk.bold(r.client.padEnd(10))} ${r.message}`);
      }
    });

  mcp
    .command('doctor')
    .description('Verify MCP integration health for all clients')
    .option('--client <name>', 'check only one client')
    .option('--strict', 'exit with non-zero status if any check fails')
    .action((opts: { client?: string; strict?: boolean }) => {
      const client = (['cursor', 'claude', 'codex', 'opencode'] as const).includes(opts.client as 'cursor' | 'claude' | 'codex' | 'opencode')
        ? opts.client as ClientName
        : undefined;
      const checks = doctorCheck(defaultMcpCwd(), client);
      let anyFailed = false;
      console.log(chalk.bold('\n  MCP integration health\n'));
      for (const c of checks) {
        const icon = c.status === 'ok' ? chalk.green('✓') : c.status === 'broken' ? chalk.red('✗') : chalk.gray('–');
        console.log(`  ${icon} ${chalk.bold(c.client.padEnd(10))} ${c.status.padEnd(8)} ${c.path}`);
        console.log(`           ${chalk.dim(c.detail)}`);
        if (c.status !== 'ok') anyFailed = true;
      }
      if (opts.strict && anyFailed) process.exit(1);
    });

  mcp
    .command('list-tools')
    .description('List all tools, resources, and prompts exposed by the aion MCP server')
    .action(async () => {
      const { buildResourceList } = await import('../../mcp/resources.js');
      const { buildPromptList } = await import('../../mcp/prompts.js');
      const tools = [
        { name: 'search_memory', desc: 'Semantic search over source code chunks' },
        { name: 'get_dep_graph', desc: 'Dependency hotspots and cycles' },
        { name: 'get_health_score', desc: 'Zero-token composite health score' },
        { name: 'get_hot_zones', desc: 'Highest-risk files by churn + complexity' },
        { name: 'get_impact', desc: 'Transitive impact of changing a file' },
      ];
      console.log(chalk.bold('\n  aion MCP tools\n'));
      for (const t of tools) {
        console.log(`  ${chalk.cyan(t.name.padEnd(22))} ${t.desc}`);
      }
      const resources = buildResourceList({ cwd: defaultMcpCwd(), traceId: 'list' });
      console.log(chalk.bold('\n  aion MCP resources\n'));
      for (const r of resources) {
        const prio = chalk.dim(`[p=${r.annotations.priority}]`);
        console.log(`  ${chalk.cyan(r.uri.padEnd(38))} ${prio} ${r.name}`);
      }
      const prompts = buildPromptList();
      console.log(chalk.bold('\n  aion MCP prompts\n'));
      for (const p of prompts) {
        console.log(`  ${chalk.cyan(p.name.padEnd(28))} ${p.description}`);
      }
      const claude = readClaudeConfig();
      console.log('');
      console.log(claude && claude.servers['aion']
        ? chalk.green('  Registered in ~/.claude/mcp.json')
        : chalk.gray('  Not registered — run `aion mcp install --client claude` to connect to Claude Desktop'));
    });

  mcp
    .command('tail')
    .description('Tail the MCP server log file (like journalctl)')
    .option('--since <timestamp>', 'show entries since ISO timestamp')
    .option('--log-file <path>', 'log file path', '.ai-runtime/mcp.log')
    .action((opts: { since?: string; logFile?: string }) => {
      startTailing(opts.logFile ?? '.ai-runtime/mcp.log', opts.since);
    });

  mcp
    .command('cost')
    .description('Show token consumption and observability summary')
    .option('--since <timestamp>', 'show entries since ISO timestamp')
    .option('--limit <n>', 'number of recent entries to show', '20')
    .action((opts: { since?: string; limit?: string }) => {
      const limit = parseInt(opts.limit ?? '20', 10) || 20;
      const summary = observabilitySummary();
      console.log(chalk.bold('\n  Observability summary\n'));
      console.log(`  total calls:   ${chalk.cyan(summary.total)}`);
      console.log(`  errors:        ${summary.errors === 0 ? chalk.green(summary.errors) : chalk.red(summary.errors)}`);
      console.log(`  avg duration:  ${chalk.cyan(summary.avgDurationMs + 'ms')}`);
      console.log(`  p50 duration:  ${chalk.cyan(summary.p50 + 'ms')}`);
      console.log(`  p95 duration:  ${chalk.cyan(summary.p95 + 'ms')}`);
      console.log(`  total tokens:  ${chalk.cyan(summary.totalTokens.toLocaleString())}`);
      console.log(chalk.bold(`\n  Last ${limit} requests\n`));
      const entries = opts.since ? recentEntries() : recentEntries(limit);
      const filtered = opts.since
        ? entries.filter((e) => Date.parse(e.ts) >= Date.parse(opts.since!))
        : entries;
      for (const e of filtered) {
        const status = e.status === 'ok' ? chalk.green('OK') : chalk.red('ERR');
        const target = e.tool ?? e.resource ?? '?';
        console.log(`  ${status}  ${chalk.dim(e.ts)}  ${chalk.cyan(target.padEnd(30))}  ${e.durationMs}ms  ${e.estTokens}t  ${chalk.dim(e.traceId)}`);
      }
    });
}
