import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative } from 'path';
import { KnowledgeStore } from '../../infra/knowledge.js';
import { chunkFile } from '../../infra/chunker.js';
import { buildDepGraph, formatDepReport } from '../../infra/dep-graph.js';
import { buildRepoIndex, writeRepoIndex } from '../../infra/repo-index.js';
import { formatRepoQuery, loadRepoIndex, queryRepoIndex } from '../../infra/repo-query.js';
import { SOURCE_EXTS as SRC_EXTS, IGNORE_DIRS } from '../../core/pipelines/audit-file-scanner.js';

const SOURCE_EXTS = new Set(SRC_EXTS);

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) results.push(...collectSourceFiles(full));
        else if (SOURCE_EXTS.has(entry.slice(entry.lastIndexOf('.')))) results.push(full);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return results;
}

export function registerMemory(program: Command): void {
  const memory = program
    .command('memory')
    .description('Manage the .ai-memory knowledge base');

  // ── ai memory build ───────────────────────────────────────────────────────
  memory
    .command('build')
    .description('Index .ai-memory/ + source code into the embedding vector store')
    .option('--no-src', 'skip source code indexing, only index .ai-memory/')
    .option('--src-dir <dir>', 'source directory to index (default: cwd)')
    .action(async (options: { src: boolean; srcDir?: string }) => {
      const cwd = process.cwd();
      const store = new KnowledgeStore(cwd);
      const spinner = ora('Building embedding index...').start();

      try {
        // 1. Index .ai-memory/ entries (bugs, decisions, patterns, etc.)
        const knowledgeCount = await store.embeddings.buildIndex([
          'architecture', 'bugs', 'features', 'decisions', 'patterns',
        ]);

        let srcCount = 0;
        if (options.src !== false) {
          // 2. Index source code via Tree-sitter chunks
          const srcDir = options.srcDir ? join(cwd, options.srcDir) : cwd;
          const files = collectSourceFiles(srcDir);
          spinner.text = `Chunking ${files.length} source files...`;

          const srcMemoryDir = join(cwd, '.ai-memory', 'architecture');
          mkdirSync(srcMemoryDir, { recursive: true });

          for (const file of files) {
            const chunks = await chunkFile(file, 1200);
            for (const chunk of chunks) {
              const relPath = relative(cwd, file);
              const slug = `${relPath.replace(/[/\\]/g, '__')}__${chunk.name}`.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
              const content = `\`\`\`\n// ${relPath}:${chunk.startLine}-${chunk.endLine} [${chunk.type}: ${chunk.name}]\n${chunk.text}\n\`\`\``;
              const outPath = join(srcMemoryDir, `src__${slug}.md`);
              writeFileSync(outPath, `# ${chunk.name} (${relPath}:${chunk.startLine})\n\n${content}\n`, 'utf8');
              srcCount++;
            }
            spinner.text = `Chunked ${srcCount} chunks from ${files.indexOf(file) + 1}/${files.length} files...`;
          }

          // Re-index now that source chunks are written
          await store.embeddings.buildIndex(['architecture']);
        }

        spinner.succeed(chalk.green(
          `Indexed ${knowledgeCount} knowledge entries + ${srcCount} source chunks`,
        ));
        console.log(chalk.gray('Run `ai memory search "<query>"` to test retrieval.'));
      } catch (err) {
        spinner.fail(chalk.red('Build failed: ' + String(err)));
        process.exit(1);
      }
    });

  // ── ai memory search ──────────────────────────────────────────────────────
  memory
    .command('search <query>')
    .description('Semantic search over the .ai-memory knowledge base')
    .option('-k, --top-k <n>', 'number of results', '5')
    .action(async (query: string, options: { topK: string }) => {
      const store = new KnowledgeStore(process.cwd());

      if (!store.embeddings.hasIndex()) {
        console.error(chalk.yellow('No embedding index found. Run `ai memory build` first.'));
        process.exit(1);
      }

      const spinner = ora('Searching...').start();

      try {
        const topK = Math.max(1, parseInt(options.topK, 10) || 5);
        const results = await store.embeddings.query(query, topK);
        spinner.stop();

        if (results.length === 0) {
          console.log(chalk.gray('No results found.'));
          return;
        }

        console.log(chalk.bold(`\nTop ${results.length} results for: "${query}"\n`));
        for (const r of results) {
          const score = chalk.cyan(`${(r.score * 100).toFixed(1)}%`);
          console.log(`${score}  ${chalk.bold(r.category + '/' + r.filename)}`);
          console.log(chalk.gray('  ' + r.text.split('\n')[0]?.slice(0, 100)));
          console.log();
        }
      } catch (err) {
        spinner.fail(chalk.red('Search failed: ' + String(err)));
        process.exit(1);
      }
    });

  // ── ai memory deps ───────────────────────────────────────────────────────
  memory
    .command('deps')
    .description('Build dependency graph and save to .ai-memory/architecture/')
    .action(() => {
      const cwd = process.cwd();
      const spinner = ora('Analysing imports...').start();

      try {
        const graph = buildDepGraph(cwd);
        const report = formatDepReport(graph);

        const store = new KnowledgeStore(cwd);
        store.writeEntry('architecture', 'Dependency Graph', report);

        spinner.succeed(chalk.green(
          `Dependency graph: ${graph.nodes.size} modules, ${graph.cycles.length} cycles, ${graph.hotspots.length} hotspots`,
        ));

        if (graph.cycles.length > 0) {
          console.log(chalk.yellow('\nCircular dependencies found:'));
          graph.cycles.slice(0, 5).forEach((c) => console.log(chalk.yellow('  ' + c.join(' → '))));
        }

        console.log(chalk.bold('\nTop hotspots:'));
        graph.hotspots.slice(0, 5).forEach((h) =>
          console.log(`  ${chalk.cyan(h.file)} — fan-in: ${h.fanIn}, fan-out: ${h.fanOut}`),
        );
      } catch (err) {
        spinner.fail(chalk.red('Dep graph failed: ' + String(err)));
        process.exit(1);
      }
    });

  // ── ai memory list ────────────────────────────────────────────────────────
  memory
    .command('index')
    .description('Build deterministic repository intelligence index')
    .action(async () => {
      const cwd = process.cwd();
      const spinner = ora('Building repository index...').start();

      try {
        const index = await buildRepoIndex(cwd);
        const path = writeRepoIndex(cwd, index);

        spinner.succeed(chalk.green(
          `Repo index: ${index.stats.files} files, ${index.stats.symbols} symbols, ${index.stats.imports} imports, ${index.stats.chunks} chunks`,
        ));
        console.log(chalk.gray(`Saved: ${path}`));

        const untested = index.files.filter((file) =>
          !file.isTest && !index.tests.some((link) => link.source === file.path),
        ).length;
        console.log(chalk.gray(`Probable untested source files: ${untested}`));
      } catch (err) {
        spinner.fail(chalk.red('Repo index failed: ' + String(err)));
        process.exit(1);
      }
    });

  memory
    .command('query <query>')
    .description('Query deterministic repository index')
    .option('-k, --top-k <n>', 'number of file/symbol results', '10')
    .action((query: string, options: { topK: string }) => {
      const index = loadRepoIndex(process.cwd());
      if (!index) {
        console.error(chalk.yellow('No repo index found. Run `ai memory index` first.'));
        process.exit(1);
      }

      const topK = Math.max(1, parseInt(options.topK, 10) || 10);
      console.log(formatRepoQuery(queryRepoIndex(index, query, topK)));
    });

  memory
    .command('list')
    .description('List all entries in .ai-memory/')
    .action(() => {
      const store = new KnowledgeStore(process.cwd());
      const categories = ['architecture', 'bugs', 'features', 'decisions', 'patterns'] as const;
      let total = 0;

      for (const cat of categories) {
        const text = store.readCategory(cat);
        if (!text) continue;
        const count = text.split('---').length;
        console.log(chalk.bold(`${cat}:`) + chalk.gray(` ${count} entries`));
        total += count;
      }

      if (total === 0) {
        console.log(chalk.gray('.ai-memory/ is empty. Fix a bug with `ai fix` to populate it.'));
      } else {
        console.log(chalk.green(`\nTotal: ${total} entries`));
        if (!store.embeddings.hasIndex()) {
          console.log(chalk.yellow('Embeddings not built. Run `ai memory build` for semantic search.'));
        }
      }
    });
}
