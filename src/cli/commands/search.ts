import type { Command } from 'commander';
import chalk from 'chalk';
import { GraphAgent } from '../../agents/graph-agent.js';
import { ensureRepoVectorIndex, queryRepoVectors } from '../../infra/repo-vectors.js';

export function registerSearch(program: Command): void {
  program
    .command('search <query...>')
    .description('[DEPRECATED] the repo index by file, symbol, and code chunks without AI tokens')
    .option('--limit <n>', 'number of matches to show', '10')
    .option('--semantic', 'use chunk-level semantic-style search over indexed code')
    .option('--rebuild', 'rebuild the repository index before searching')
    .action(async (queryWords: string[], options: { limit: string; semantic?: boolean; rebuild?: boolean }) => {
      const cwd = process.cwd();
      const query = queryWords.join(' ');
      const limit = Math.max(1, Math.min(50, parseInt(options.limit, 10) || 10));
      const graph = new GraphAgent(cwd);
      const index = options.rebuild ? await graph.buildIndex() : await graph.ensureIndex();

      console.log(chalk.bold.cyan(`\nSearch: ${query}\n`));
      if (options.semantic) {
        const vectors = await ensureRepoVectorIndex(cwd, index, Boolean(options.rebuild));
        const results = await queryRepoVectors(vectors, query, limit);
        if (results.length === 0) {
          console.log(chalk.yellow('No vector matches.'));
          return;
        }
        results.forEach((item, i) => {
          const pct = Math.round(item.score * 100);
          const scoreColor = pct >= 80 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;
          console.log(`${chalk.cyan(`${i + 1}.`)} ${chalk.bold(item.file)}:${item.startLine}-${item.endLine} ${scoreColor(`${pct}%`)} ${chalk.dim(`[${item.type}]`)}`);
          console.log(chalk.dim(`   ${item.name}`));
          if (item.text) console.log(chalk.gray(item.text.split('\n').slice(0, 4).map((line) => `   ${line}`).join('\n')));
          console.log();
        });
        return;
      }

      const result = graph.query(query, limit);
      if (!result) {
        console.log(chalk.yellow('No repository index available.'));
        return;
      }
      result.files.forEach((file, i) => console.log(`${chalk.cyan(`${i + 1}.`)} ${chalk.bold(file.path)} ${chalk.gray(`${file.loc} loc${file.isTest ? ', test' : ''}`)}`));
      if (result.symbols.length > 0) {
        console.log(chalk.bold('\nSymbols:'));
        result.symbols.forEach((symbol) => console.log(`  ${chalk.cyan(symbol.name)} ${chalk.gray(symbol.kind)} ${symbol.file}:${symbol.line}`));
      }
      if (result.tests.length > 0) {
        console.log(chalk.bold('\nProbable tests:'));
        result.tests.forEach((link) => console.log(`  ${link.source} <= ${link.tests.join(', ')}`));
      }
    });
}
