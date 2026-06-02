import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { KnowledgeStore } from '../../infra/knowledge.js';

export function registerMemory(program: Command): void {
  const memory = program
    .command('memory')
    .description('Manage the .ai-memory knowledge base');

  // ── ai memory build ───────────────────────────────────────────────────────
  memory
    .command('build')
    .description('Index .ai-memory/ entries into the embedding vector store')
    .action(async () => {
      const store = new KnowledgeStore(process.cwd());
      const spinner = ora('Building embedding index...').start();

      try {
        const count = await store.embeddings.buildIndex([
          'architecture',
          'bugs',
          'features',
          'decisions',
          'patterns',
        ]);
        spinner.succeed(chalk.green(`Indexed ${count} entries into .ai-memory/.embeddings/`));
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

  // ── ai memory list ────────────────────────────────────────────────────────
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
