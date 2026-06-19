import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  initWorkspace,
  readWorkspaceConfig,
  resolveRepoPath,
  type WorkspaceConfig,
  type WorkspaceRepo,
} from '../../infra/workspace.js';
import { runSync, type SyncOptions } from './sync.js';
import { buildDepGraphAuto } from '../../infra/dep-graph.js';
import {
  runWorkspaceSearch,
  renderWorkspaceSearchMarkdown,
  renderWorkspaceWikiMarkdown,
  collectWorkspaceStores,
  writeWorkspaceWiki,
} from './workspace-search.js';

export interface WorkspaceSyncOptions extends SyncOptions {
  cwd: string;
  workspaceRoot: string;
  repo: WorkspaceRepo;
}

export async function runRepoSync(options: WorkspaceSyncOptions): Promise<{ repo: WorkspaceRepo; durationMs: number; error?: string }> {
  const start = Date.now();
  const repoPath = resolveRepoPath(options.workspaceRoot, options.repo);
  if (!existsSync(repoPath)) {
    return { repo: options.repo, durationMs: Date.now() - start, error: `path does not exist: ${options.repo.path}` };
  }
  try {
    await runSync(repoPath, { skipEmbeddings: options.skipEmbeddings, quiet: true });
    return { repo: options.repo, durationMs: Date.now() - start };
  } catch (err) {
    return { repo: options.repo, durationMs: Date.now() - start, error: String(err) };
  }
}

export interface WorkspaceSyncResult {
  workspace: WorkspaceConfig;
  results: Array<{ repo: WorkspaceRepo; durationMs: number; error?: string }>;
  totalDurationMs: number;
}

export async function runWorkspaceSync(workspaceRoot: string, options: { skipEmbeddings?: boolean } = {}): Promise<WorkspaceSyncResult> {
  const config = readWorkspaceConfig(workspaceRoot);
  if (!config) throw new Error(`No workspace.json found in ${workspaceRoot}. Run \`aion workspace init\` first.`);

  const start = Date.now();
  const results = await Promise.all(
    config.repos.map((repo) => runRepoSync({
      cwd: resolveRepoPath(workspaceRoot, repo),
      workspaceRoot,
      repo,
      skipEmbeddings: options.skipEmbeddings,
    })),
  );
  return { workspace: config, results, totalDurationMs: Date.now() - start };
}

export function renderWorkspaceSummary(result: WorkspaceSyncResult): string {
  const lines: string[] = [];
  lines.push(`# Workspace: ${result.workspace.name}\n`);
  lines.push(`Root: \`${result.workspace.root}\`\n`);
  lines.push(`Repos: ${result.workspace.repos.length}\n`);
  lines.push(`Total sync time: ${result.totalDurationMs}ms\n`);
  lines.push(`## Repositories\n`);
  for (const r of result.results) {
    const icon = r.error ? '✗' : '✓';
    const status = r.error ? `failed: ${r.error}` : `${r.durationMs}ms`;
    lines.push(`- ${icon} \`${r.repo.path}\` — ${status}`);
  }
  const totalCycles = result.results.length;
  lines.push(`\n## Summary`);
  lines.push(`- Synced: ${result.results.filter((r) => !r.error).length}`);
  lines.push(`- Failed: ${result.results.filter((r) => r.error).length}`);
  return lines.join('\n');
}

export function listRepos(config: WorkspaceConfig): Array<{ repo: WorkspaceRepo; language?: string; hasPackageJson: boolean; loc?: number }> {
  return config.repos.map((repo) => {
    const repoPath = resolveRepoPath(config.root, repo);
    const hasPackageJson = existsSync(join(repoPath, 'package.json'));
    let language: string | undefined;
    if (hasPackageJson) language = 'typescript';
    return { repo, language, hasPackageJson };
  });
}

export function registerWorkspace(program: Command): void {
  const workspace = program
    .command('workspace')
    .description('Multi-repo workspace — sync, list, and aggregate across multiple projects');

  workspace
    .command('init')
    .description('Initialize a workspace in the current directory (detects sub-repos)')
    .option('--name <name>', 'workspace name (default: directory basename)')
    .option('--no-detect', 'do not auto-detect sub-repos; create empty workspace')
    .option('--add <path>', 'add an additional repo by path (can be repeated)', (val: string, prev: string[]) => [...(prev ?? []), val], [])
    .action(async (opts: { name?: string; detect?: boolean; add?: string[] }) => {
      const cwd = process.cwd();
      const config = initWorkspace(cwd, opts.name, opts.detect !== false);
      console.log(chalk.green(`  ✓ workspace.json created (${config.repos.length} repo(s) detected)`));
      for (const r of config.repos) {
        console.log(chalk.dim(`    ${r.path}`));
      }
      if (opts.add && opts.add.length > 0) {
        const { addRepoToWorkspace } = await import('../../infra/workspace.js');
        for (const path of opts.add) {
          const repo = { name: path.split('/').pop() ?? path, path };
          const updated = addRepoToWorkspace(cwd, repo);
          if (updated) console.log(chalk.green(`  + added ${path}`));
        }
      }
    });

  workspace
    .command('list')
    .description('List repos in the workspace')
    .action(() => {
      const cwd = process.cwd();
      const config = readWorkspaceConfig(cwd);
      if (!config) {
        console.log(chalk.yellow(`  No workspace.json in ${cwd}. Run \`aion workspace init\`.`));
        return;
      }
      console.log(chalk.bold(`\n  ${config.name} (${config.repos.length} repos)\n`));
      for (const item of listRepos(config)) {
        const lang = item.language ? chalk.dim(` [${item.language}]`) : '';
        console.log(`  • ${item.repo.path}${lang}`);
      }
    });

  workspace
    .command('sync')
    .description('Run aion sync on all repos in the workspace (in parallel)')
    .option('--skip-embeddings', 'skip embedding generation (faster)')
    .action(async (opts: { skipEmbeddings?: boolean }) => {
      const cwd = process.cwd();
      const result = await runWorkspaceSync(cwd, { skipEmbeddings: opts.skipEmbeddings });
      console.log(chalk.bold(`\n  ${result.workspace.name} — synced ${result.results.length} repos in ${result.totalDurationMs}ms\n`));
      for (const r of result.results) {
        const icon = r.error ? chalk.red('✗') : chalk.green('✓');
        const status = r.error ? chalk.red(r.error) : chalk.dim(`${r.durationMs}ms`);
        console.log(`  ${icon} ${r.repo.path.padEnd(40)} ${status}`);
      }
    });

  workspace
    .command('info')
    .description('Show workspace info: name, root, repo count, languages')
    .action(() => {
      const cwd = process.cwd();
      const config = readWorkspaceConfig(cwd);
      if (!config) {
        console.log(chalk.yellow(`  No workspace.json in ${cwd}. Run \`aion workspace init\`.`));
        return;
      }
      console.log(chalk.bold(`\n  Workspace: ${config.name}\n`));
      console.log(`  Root: ${chalk.cyan(config.root)}`);
      console.log(`  Repos: ${chalk.cyan(config.repos.length)}`);
      console.log(`  Created: ${chalk.dim(config.createdAt)}`);
      console.log(`  Updated: ${chalk.dim(config.updatedAt)}`);
    });

  workspace
    .command('search <query>')
    .description('Search across all repos in the workspace')
    .option('--top-k <n>', 'total results', '10')
    .option('--per-repo <n>', 'limit per repo', '5')
    .action(async (query: string, opts: { topK?: string; perRepo?: string }) => {
      const cwd = process.cwd();
      const topK = parseInt(opts.topK ?? '10', 10) || 10;
      const perRepo = parseInt(opts.perRepo ?? '5', 10) || 5;
      const result = await runWorkspaceSearch({ workspaceRoot: cwd, query, topK, perRepoLimit: perRepo });
      console.log(chalk.bold(`\n  Search "${query}" — ${result.results.length} result(s) from ${result.reposSearched} repo(s) in ${result.totalDurationMs}ms\n`));
      for (const r of result.results) {
        console.log(`  ${chalk.cyan(r.repo.path)} :: ${r.file}:${r.startLine}-${r.endLine}`);
        console.log(`     ${chalk.dim(r.name)} (${r.type}) — ${chalk.yellow((r.score * 100).toFixed(1) + '%')}`);
      }
    });

  workspace
    .command('wiki')
    .description('Generate WORKSPACE.md aggregating all repos')
    .action(() => {
      const cwd = process.cwd();
      const config = readWorkspaceConfig(cwd);
      if (!config) {
        console.log(chalk.yellow(`  No workspace.json in ${cwd}. Run \`aion workspace init\`.`));
        return;
      }
      const stores = collectWorkspaceStores(config);
      const md = renderWorkspaceWikiMarkdown(config, stores);
      const path = writeWorkspaceWiki(cwd, md);
      console.log(chalk.green(`  ✓ WORKSPACE.md written: ${path}`));
      console.log(chalk.dim(`  ${config.repos.length} repos · ${stores.size} with PIL`));
    });
}

void buildDepGraphAuto;
