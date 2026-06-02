import { formatRepoQuery, loadRepoIndex, queryRepoIndex } from '../infra/repo-query.js';

export function buildRepoContext(cwd: string, target: string): string {
  const index = loadRepoIndex(cwd);
  if (!index) return '';
  const result = queryRepoIndex(index, target, 8);
  return [
    `Repository index: ${index.stats.files} files, ${index.stats.symbols} symbols, ${index.stats.imports} imports, ${index.stats.chunks} chunks.`,
    formatRepoQuery(result),
  ].join('\n\n');
}
