import { buildRepoIndex, writeRepoIndex } from '../infra/repo-index.js';
import { loadRepoIndex, queryRepoIndex, formatRepoQuery } from '../infra/repo-query.js';
import type { RepoIndex, RepoFile, RepoSymbol, TestLink } from '../infra/repo-index.js';
import type { RepoQueryResult } from '../infra/repo-query.js';

export interface GraphAgentResult {
  index: RepoIndex;
  query?: RepoQueryResult;
  summary: string;
}

export class GraphAgent {
  constructor(private readonly cwd: string) {}

  async buildIndex(): Promise<RepoIndex> {
    const index = await buildRepoIndex(this.cwd);
    writeRepoIndex(this.cwd, index);
    return index;
  }

  getIndex(): RepoIndex | null {
    return loadRepoIndex(this.cwd);
  }

  async ensureIndex(): Promise<RepoIndex> {
    return this.getIndex() ?? this.buildIndex();
  }

  query(query: string, limit = 10): RepoQueryResult | null {
    const index = this.getIndex();
    if (!index) return null;
    return queryRepoIndex(index, query, limit);
  }

  async queryWithContext(query: string, limit = 10, maxChars = 4000): Promise<string> {
    const index = await this.ensureIndex();
    const result = queryRepoIndex(index, query, limit);
    const full = [
      `Repository: ${index.stats.files} files, ${index.stats.symbols} symbols, ${index.stats.chunks} chunks`,
      formatRepoQuery(result),
    ].join('\n\n');
    return full.length > maxChars ? full.slice(0, maxChars) + '\n[truncated]' : full;
  }

  findTestsForFile(filePath: string): string[] {
    const index = this.getIndex();
    if (!index) return [];
    const link = index.tests.find((t: TestLink) => t.source === filePath);
    return link?.tests ?? [];
  }

  findSymbol(name: string): RepoSymbol | undefined {
    const index = this.getIndex();
    if (!index) return undefined;
    return index.symbols.find((s: RepoSymbol) => s.name === name);
  }

  listTestFiles(): RepoFile[] {
    const index = this.getIndex();
    if (!index) return [];
    return index.files.filter((f: RepoFile) => f.isTest);
  }

  stats(): RepoIndex['stats'] | null {
    return this.getIndex()?.stats ?? null;
  }
}
