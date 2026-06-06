import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, mkdirSync } from 'fs';
import { join, relative } from 'path';
import { KnowledgeStore } from '../../infra/knowledge.js';
import { chunkFile } from '../../infra/chunker.js';
import { embedBatch, embeddingProvider } from '../../infra/embeddings.js';
import { createVectorStore, vectorStoreBackend } from '../../infra/vector-store.js';
import { buildDepGraph, formatDepReport } from '../../infra/dep-graph.js';
import { buildRepoIndex, writeRepoIndex } from '../../infra/repo-index.js';
import { formatRepoQuery, loadRepoIndex, queryRepoIndex } from '../../infra/repo-query.js';
import { collectAuditStats } from '../../core/pipelines/audit-file-scanner.js';

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
      const provider = embeddingProvider();
      const backend = vectorStoreBackend();
      const spinner = ora(`Building index [${provider}] → ${backend}`).start();

      try {
        // 1. Index .ai-memory/ markdown entries
        const knowledgeCount = await store.embeddings.buildIndex([
          'architecture', 'bugs', 'features', 'decisions', 'patterns',
        ]);

        let srcCount = 0;
        if (options.src !== false) {
          // 2. Chunk source files and embed into VectorStore (separate from .ai-memory/)
          const srcTarget = options.srcDir ?? '.';
          const stats = collectAuditStats(cwd, srcTarget);
          const files = stats.auditFiles.map((f) => join(cwd, f));
          spinner.text = `Chunking ${files.length} source files...`;

          // Collect all chunks first for batch embedding
          const allChunks: Array<{ id: string; content: string; file: string; name: string; startLine: number; endLine: number }> = [];
          for (const file of files) {
            const chunks = await chunkFile(file, 1200);
            const relPath = relative(cwd, file);
            for (const chunk of chunks) {
              const id = `${relPath}:${chunk.startLine}:${chunk.name}`;
              const content = `// ${relPath}:${chunk.startLine}-${chunk.endLine} [${chunk.type}: ${chunk.name}]\n${chunk.text}`;
              allChunks.push({ id, content, file: relPath, name: chunk.name, startLine: chunk.startLine, endLine: chunk.endLine });
            }
          }

          srcCount = allChunks.length;
          spinner.text = `Embedding ${srcCount} chunks via ${provider}...`;

          // Batch embed all chunks (efficient: one API call per 128 chunks for Voyage)
          const vectorStore = createVectorStore(cwd);
          const texts = allChunks.map((c) => c.content);
          const vectors = await embedBatch(texts);

          spinner.text = `Saving ${srcCount} chunks to ${backend}...`;
          for (let i = 0; i < allChunks.length; i++) {
            const c = allChunks[i]!;
            await vectorStore.upsert(c.id, vectors[i]!, {
              file: c.file, name: c.name, startLine: c.startLine, endLine: c.endLine,
              preview: c.content.slice(0, 200),
            });
          }

          // Also write chunks to .ai-memory/architecture/ for backward compat with EmbeddingStore
          const srcMemoryDir = join(cwd, '.ai-memory', 'architecture');
          mkdirSync(srcMemoryDir, { recursive: true });
          for (const chunk of allChunks) {
            const slug = `${chunk.file.replace(/[/\\]/g, '__')}__${chunk.name}`.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
            const outPath = join(srcMemoryDir, `src__${slug}.md`);
            writeFileSync(outPath, `# ${chunk.name} (${chunk.file}:${chunk.startLine})\n\n\`\`\`\n${chunk.content}\n\`\`\`\n`, 'utf8');
          }
          await store.embeddings.buildIndex(['architecture']);
        }

        spinner.succeed(chalk.green(
          `Indexed ${knowledgeCount} knowledge entries + ${srcCount} source chunks`,
        ));
        console.log(chalk.gray(`  Provider: ${provider}`));
        console.log(chalk.gray(`  Backend:  ${backend}`));
        console.log(chalk.gray('  Run `aion memory search "<query>"` to test retrieval.'));
      } catch (err) {
        spinner.fail(chalk.red('Build failed: ' + String(err)));
        process.exit(1);
      }
    });

  // ── ai memory search ──────────────────────────────────────────────────────
  memory
    .command('search <query>')
    .description('Semantic search over source code chunks and .ai-memory knowledge base')
    .option('-k, --top-k <n>', 'number of results', '5')
    .option('--knowledge', 'search .ai-memory/ markdown only (skip source code chunks)')
    .action(async (query: string, options: { topK: string; knowledge?: boolean }) => {
      const cwd = process.cwd();
      const store = new KnowledgeStore(cwd);
      const topK = Math.max(1, parseInt(options.topK, 10) || 5);
      const spinner = ora('Searching...').start();

      try {
        if (options.knowledge) {
          // Knowledge-only: search .ai-memory/ markdown entries
          if (!store.embeddings.hasIndex()) {
            spinner.fail(chalk.yellow('No embedding index. Run `aion memory build` first.'));
            process.exit(1);
          }
          const results = await store.embeddings.query(query, topK);
          spinner.stop();
          if (results.length === 0) { console.log(chalk.gray('No results.')); return; }
          console.log(chalk.bold(`\nTop ${results.length} results for: "${query}"\n`));
          for (const r of results) {
            console.log(`${chalk.cyan(`${(r.score * 100).toFixed(1)}%`)}  ${chalk.bold(r.category + '/' + r.filename)}`);
            console.log(chalk.gray('  ' + r.text.split('\n')[0]?.slice(0, 100)));
            console.log();
          }
          return;
        }

        // Default: search VectorStore (source code chunks) using real embeddings
        const { embedTextRemote, embedText } = await import('../../infra/embeddings.js');
        const { createVectorStore: cvs } = await import('../../infra/vector-store.js');
        const vectorStore = cvs(cwd);

        if (vectorStore.size() === 0) {
          spinner.fail(chalk.yellow('No source code index. Run `aion memory build` first.'));
          process.exit(1);
        }

        const remote = await embedTextRemote(query);
        const queryVec = remote ? remote : Array.from(embedText(query, 500));
        const results = await vectorStore.search(queryVec, topK);
        spinner.stop();

        if (results.length === 0) { console.log(chalk.gray('No results.')); return; }

        console.log(chalk.bold(`\nTop ${results.length} source chunks for: "${query}"\n`));
        for (const r of results) {
          const score = chalk.cyan(`${(r.score * 100).toFixed(1)}%`);
          const loc = `${r.payload['file']}:${r.payload['startLine']}`;
          console.log(`${score}  ${chalk.bold(String(r.payload['name']))}  ${chalk.gray(loc)}`);
          console.log(chalk.gray('  ' + String(r.payload['preview'] ?? '').split('\n')[1]?.slice(0, 100)));
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
