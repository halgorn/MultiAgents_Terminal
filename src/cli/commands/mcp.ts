import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function registerInClaudeDesktop(command: string, args: string[]): string {
  const configPath = join(homedir(), '.claude', 'mcp.json');
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch { /* fresh config */ }

  const servers = (config['mcpServers'] ?? {}) as Record<string, unknown>;
  servers['aion'] = { command, args };
  config['mcpServers'] = servers;

  mkdirSync(join(homedir(), '.claude'), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return configPath;
}

export function registerMcp(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('MCP server — expose aion tools to Claude Desktop and other AI clients');

  mcp
    .command('serve')
    .description('Start the aion MCP server (stdio transport)')
    .option('--register', 'register in ~/.claude/mcp.json for Claude Desktop auto-connect')
    .action(async (options: { register?: boolean }) => {
      if (options.register) {
        // Find the aion binary path
        const binPath = process.argv[1] ?? 'aion';
        const configPath = registerInClaudeDesktop(binPath, ['mcp', 'serve']);
        console.error(chalk.green(`Registered aion MCP server in ${configPath}`));
        console.error(chalk.gray('Restart Claude Desktop to pick up the new server.'));
      }

      // Start server (blocks until stdin closes)
      const { startMcpServer } = await import('../../mcp/server.js');
      await startMcpServer();
    });

  mcp
    .command('list-tools')
    .description('List all tools exposed by the aion MCP server')
    .action(() => {
      const tools = [
        { name: 'search_memory', desc: 'Semantic search over source code chunks' },
        { name: 'get_dep_graph', desc: 'Dependency hotspots and cycles' },
        { name: 'get_health_score', desc: 'Zero-token composite health score' },
        { name: 'get_hot_zones', desc: 'Highest-risk files by churn + complexity' },
        { name: 'get_impact', desc: 'Transitive impact of changing a file' },
      ];

      console.log(chalk.bold('\naion MCP tools\n'));
      for (const t of tools) {
        console.log(`  ${chalk.cyan(t.name.padEnd(22))} ${t.desc}`);
      }

      const configPath = join(homedir(), '.claude', 'mcp.json');
      const registered = existsSync(configPath) &&
        readFileSync(configPath, 'utf8').includes('"aion"');
      console.log();
      console.log(registered
        ? chalk.green('  Registered in ~/.claude/mcp.json')
        : chalk.gray('  Not registered — run `aion mcp serve --register` to connect to Claude Desktop'));
    });
}
