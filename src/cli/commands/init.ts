import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import { AION_CONFIG_FILE, AION_IGNORE_FILE } from '../../infra/paths.js';
import { ensureGitignore } from '../../infra/gitignore-guard.js';
import { isProjectPrepared } from '../../infra/setup/project-setup.js';
import { runSync } from './sync.js';
import { runWikiBatch } from './wiki.js';
import { installClient, doctorCheck, type ClientName } from '../../mcp/install.js';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Bootstrap aion in the current project: config + sync + wiki + MCP install')
    .option('--force', 'overwrite existing config files')
    .option('--no-sync', 'skip the initial sync (just create config files)')
    .option('--no-wiki', 'skip generating PROJECT.md and sub-docs')
    .option('--no-mcp', 'skip MCP client install (only set up the project itself)')
    .option('--client <name>', 'MCP client to install for: cursor | claude | codex | opencode | all', 'cursor')
    .option('--skip-embeddings', 'skip embedding generation in the initial sync (faster)')
    .action(async (options: { force?: boolean; sync?: boolean; wiki?: boolean; mcp?: boolean; client?: string; skipEmbeddings?: boolean }) => {
      const cwd = process.cwd();
      const { writeDefaultConfig } = await import('../../infra/aion-config.js');

      console.log(chalk.bold.cyan('\n  ⚡ aion init — bootstrapping RAG Confidence Layer\n'));

      const rcPath = join(cwd, AION_CONFIG_FILE);
      const ignorePath = join(cwd, AION_IGNORE_FILE);

      if (existsSync(rcPath) && !options.force) {
        console.log(chalk.yellow(`  • ${AION_CONFIG_FILE} already exists (use --force to overwrite)`));
      } else {
        writeDefaultConfig(cwd);
        console.log(chalk.green(`  ✓ ${AION_CONFIG_FILE} created`));
      }

      if (existsSync(ignorePath) && !options.force) {
        console.log(chalk.yellow(`  • ${AION_IGNORE_FILE} already exists (use --force to overwrite)`));
      } else {
        const { writeFileSync } = await import('fs');
        writeFileSync(ignorePath, [
          '# aion ignore patterns (glob syntax)',
          '# Files matching these patterns are skipped during audit',
          '',
          '# Generated files',
          '*.generated.*',
          '*.pb.ts',
          '*.pb.js',
          '',
          '# Test fixtures & mocks',
          'fixtures/**',
          'testdata/**',
          '__mocks__/**',
          '',
          '# Vendored / third-party',
          'vendor/**',
          'third_party/**',
          '',
        ].join('\n'), 'utf8');
        console.log(chalk.green(`  ✓ ${AION_IGNORE_FILE} created`));
      }

      const { added } = ensureGitignore(cwd);
      if (added.length > 0) {
        console.log(chalk.green(`  ✓ .gitignore updated (${added.length} aion entries added)`));
      } else {
        console.log(chalk.dim('  • .gitignore already up to date'));
      }

      if (options.sync !== false) {
        console.log(chalk.dim('\n  → running aion sync…'));
        try {
          const result = await runSync(cwd, { skipEmbeddings: options.skipEmbeddings, quiet: true });
          console.log(chalk.green(`  ✓ PIL built: ${result.store.stats.files} files, ${result.store.stats.chunks} chunks, ${result.store.stats.vectors} vectors (${result.durationMs}ms)`));
        } catch (err) {
          console.log(chalk.yellow(`  ! sync failed: ${String(err)}`));
        }
      }

      if (options.wiki !== false) {
        console.log(chalk.dim('\n  → generating PROJECT.md and sub-docs…'));
        try {
          const batch = await runWikiBatch({ cwd, tokenBudget: 4000 });
          console.log(chalk.green(`  ✓ Dashboard: ${batch.dashboard.path}`));
          for (const d of batch.subDocs) {
            console.log(chalk.dim(`    ${d.name.padEnd(20)} ${d.path}`));
          }
        } catch (err) {
          console.log(chalk.yellow(`  ! wiki generation failed: ${String(err)}`));
        }
      }

      if (options.mcp !== false) {
        const client = (['cursor', 'claude', 'codex', 'opencode', 'all'] as const).includes(options.client as 'cursor' | 'claude' | 'codex' | 'opencode' | 'all')
          ? options.client as ClientName | 'all'
          : 'cursor';
        console.log(chalk.dim(`\n  → installing MCP for ${client}…`));
        const binPath = process.argv[1] ?? 'aion';
        const results = installClient({ client, cwd, binPath, args: ['mcp', 'serve'] });
        for (const r of results) {
          const icon = r.written ? chalk.green('✓') : chalk.gray('–');
          console.log(`  ${icon} ${chalk.bold(r.client.padEnd(10))} ${r.message}`);
        }
        const checks = doctorCheck(cwd);
        const failed = checks.filter((c) => c.status !== 'ok');
        if (failed.length === 0) {
          console.log(chalk.green('\n  ✓ all clients OK'));
        } else {
          console.log(chalk.yellow(`\n  ! ${failed.length} client(s) need attention — run \`aion mcp doctor\``));
        }
      }

      console.log(chalk.bold.cyan('\n  ✅ aion is ready\n'));
      console.log(chalk.bold('  Next steps:\n'));
      console.log(`  ${chalk.cyan('aion mcp doctor')}        ${chalk.dim('— verify integration')}`);
      console.log(`  ${chalk.cyan('aion watch --auto-sync')}  ${chalk.dim('— keep PIL fresh on file changes')}`);
      console.log(`  ${chalk.cyan('aion chat')}               ${chalk.dim('— talk to AI with full repo context')}`);
      console.log(`  ${chalk.cyan('aion audit .')}            ${chalk.dim('— run a multi-agent audit')}`);
      console.log('');
      console.log(chalk.dim('  The PROJECT.md and sub-docs contain a "How AI agents should use this" section'));
      console.log(chalk.dim('  that bootstraps any MCP-compatible agent (Cursor, Claude Code, Codex, OpenCode).'));
      console.log('');

      const prepared = isProjectPrepared(cwd);
      if (!prepared) {
        console.log(chalk.dim('  (Tip: run `aion setup` for the interactive wizard.)\n'));
      }
    });
}
