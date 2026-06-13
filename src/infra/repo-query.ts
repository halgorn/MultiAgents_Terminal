import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { RepoFile, RepoImport, RepoIndex, RepoSymbol, TestLink } from './repo-index.js';
import { buildRepoIndex, writeRepoIndex } from './repo-index.js';
import { AI_RUNTIME_DIR } from './paths.js';

export interface RepoQueryResult {
  files: RepoFile[];
  symbols: RepoSymbol[];
  imports: RepoImport[];
  tests: TestLink[];
}

export function loadRepoIndex(cwd: string): RepoIndex | null {
  const path = join(cwd, AI_RUNTIME_DIR, 'repo-index.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RepoIndex;
  } catch {
    return null;
  }
}

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((term) => term.length > 1);
}

function score(text: string, queryTerms: string[]): number {
  const haystack = text.toLowerCase();
  return queryTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
}

export function queryRepoIndex(index: RepoIndex, query: string, limit = 10): RepoQueryResult {
  const queryTerms = terms(query);
  const files = index.files
    .map((file) => ({ file, score: score(file.path, queryTerms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.file.isTest) - Number(b.file.isTest) || a.file.path.localeCompare(b.file.path))
    .slice(0, limit)
    .map((item) => item.file);

  const symbols = index.symbols
    .map((symbol) => ({ symbol, score: score(`${symbol.name} ${symbol.file}`, queryTerms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.symbol.file.localeCompare(b.symbol.file))
    .slice(0, limit)
    .map((item) => item.symbol);

  const selectedFiles = new Set([...files.map((file) => file.path), ...symbols.map((symbol) => symbol.file)]);
  const imports = index.imports
    .filter((imp) => selectedFiles.has(imp.from) || (imp.resolved && selectedFiles.has(imp.resolved)))
    .slice(0, limit * 2);

  const tests = index.tests
    .filter((link) => selectedFiles.has(link.source) || link.tests.some((test) => selectedFiles.has(test)))
    .slice(0, limit);

  return { files, symbols, imports, tests };
}

export function formatRepoQuery(result: RepoQueryResult): string {
  const lines: string[] = [];

  if (result.files.length > 0) {
    lines.push('Files:');
    result.files.forEach((file) => lines.push(`  ${file.path} (${file.loc} loc${file.isTest ? ', test' : ''})`));
  }

  if (result.symbols.length > 0) {
    lines.push('Symbols:');
    result.symbols.forEach((symbol) => lines.push(`  ${symbol.name} ${symbol.kind} ${symbol.file}:${symbol.line}`));
  }

  if (result.imports.length > 0) {
    lines.push('Imports:');
    result.imports.forEach((imp) => lines.push(`  ${imp.from} -> ${imp.resolved ?? imp.specifier}`));
  }

  if (result.tests.length > 0) {
    lines.push('Probable tests:');
    result.tests.forEach((link) => lines.push(`  ${link.source} <= ${link.tests.join(', ')}`));
  }

  return lines.join('\n') || 'No repository index matches.';
}

export async function ensureRepoIndex(cwd: string): Promise<RepoIndex> {
  const existing = loadRepoIndex(cwd);
  if (existing) return existing;
  const index = await buildRepoIndex(cwd);
  writeRepoIndex(cwd, index);
  return index;
}
