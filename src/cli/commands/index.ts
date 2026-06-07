import type { Command } from 'commander';
import chalk from 'chalk';
import { buildRepoIndex, writeRepoIndex } from '../../infra/repo-index.js';
import { buildRepoVectorIndex } from '../../infra/repo-vectors.js';
import { writeSetupState, readSetupState, createSetupState } from '../../infra/setup/project-setup.js';

export function registerIndex(program: Command): void {
  program
    .command('index')
    .description('Rebuild the repository index (AST chunks + semantic embeddings)')
    .option('--quiet', 'suppress output — for use in git hooks')
    .action(async (options: { quiet?: boolean }) => {
      const cwd = process.cwd();
      const log = options.quiet ? () => {} : (s: string) => process.stdout.write(s + '\n');

      log(chalk.bold.cyan('\n⏳ Indexando repositório…'));

      const index = await buildRepoIndex(cwd);
      writeRepoIndex(cwd, index);
      log(chalk.green(`✓ Estrutura: ${index.stats.files} arquivos, ${index.stats.chunks} chunks AST`));

      log(chalk.dim('  Gerando embeddings semânticos…'));
      let vectorCount = 0;
      await buildRepoVectorIndex(cwd, index, (done, total) => {
        vectorCount = done;
        if (!options.quiet) {
          process.stdout.write(`\r  ${done}/${total} vetores`);
        }
      });
      if (!options.quiet) process.stdout.write('\n');
      log(chalk.green(`✓ Vetores: ${vectorCount} chunks embedados`));

      // Update setup state to mark indexes as ready
      const existing = readSetupState(cwd);
      if (existing) {
        writeSetupState(cwd, createSetupState(cwd, {
          ...existing,
          progress: { ...existing.progress, localIndexReady: true, dependencyMapReady: true },
        }));
      }

      log(chalk.bold('\n✓ Índice atualizado.\n'));
    });
}
