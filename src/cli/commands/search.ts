import type { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GraphAgent } from '../../agents/graph-agent.js';
import type { RepoChunk, RepoIndex } from '../../infra/repo-index.js';

function terms(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9_./-]+/).filter((term) => term.length > 1);
}

function scoreText(text: string, queryTerms: string[]): number {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) score += 4;
    const parts = term.split(/[-_/]/).filter(Boolean);
    score += parts.filter((part) => haystack.includes(part)).length;
  }
  return score;
}

function readSnippet(cwd: string, chunk: RepoChunk): string {
  try {
    const lines = readFileSync(join(cwd, chunk.file), 'utf8').split('\n');
    return lines.slice(chunk.startLine - 1, Math.min(chunk.endLine, chunk.startLine + 18)).join('\n').trim();
  } catch {
    return '';
  }
}

function searchChunks(cwd: string, index: RepoIndex, query: string, limit: number): Array<{ chunk: RepoChunk; score: number; snippet: string }> {
  const queryTerms = terms(query);
  return index.chunks
    .map((chunk) => {
      const snippet = readSnippet(cwd, chunk);
      const text = `${chunk.file} ${chunk.name} ${chunk.type} ${snippet}`;
      return { chunk, score: scoreText(text, queryTerms), snippet };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.file.localeCompare(b.chunk.file))
    .slice(0, limit);
}

export function registerSearch(program: Command): void {
  program
    .command('search <query...>')
    .description('Search the repo index by file, symbol, and code chunks without AI tokens')
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
        const results = searchChunks(cwd, index, query, limit);
        if (results.length === 0) {
          console.log(chalk.yellow('No chunk matches.'));
          return;
        }
        results.forEach((item, i) => {
          console.log(`${chalk.cyan(`${i + 1}.`)} ${chalk.bold(item.chunk.file)}:${item.chunk.startLine}-${item.chunk.endLine} ${chalk.gray(`[${item.chunk.type} ${item.score}]`)}`);
          console.log(chalk.dim(`   ${item.chunk.name}`));
          if (item.snippet) console.log(chalk.gray(item.snippet.split('\n').slice(0, 4).map((line) => `   ${line}`).join('\n')));
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
