import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { chunkFile } from './chunker.js';
import { isGeneratedArtifact, isIgnoredDirName } from './file-filter.js';
import { AI_RUNTIME_DIR } from './paths.js';
import { shouldExcludePath } from '../security/exclude-list.js';

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rb', '.rs', '.cs', '.php', '.kt', '.swift', '.c', '.cpp', '.h']);
const MAX_FILE_SIZE = 200 * 1024;

export interface RepoFile {
  path: string;
  ext: string;
  loc: number;
  bytes: number;
  isTest: boolean;
}

export interface RepoSymbol {
  name: string;
  kind: 'function' | 'class' | 'method' | 'const' | 'unknown';
  file: string;
  line: number;
}

export interface RepoImport {
  from: string;
  specifier: string;
  resolved?: string;
}

export interface RepoChunk {
  file: string;
  name: string;
  type: 'function' | 'class' | 'method' | 'block' | 'arrow_function' | 'export_statement' | 'variable_declaration';
  startLine: number;
  endLine: number;
  tokens: number;
}

export interface TestLink {
  source: string;
  tests: string[];
}

export interface RepoIndex {
  version: 1;
  generatedAt: string;
  root: string;
  files: RepoFile[];
  symbols: RepoSymbol[];
  imports: RepoImport[];
  chunks: RepoChunk[];
  tests: TestLink[];
  stats: {
    files: number;
    symbols: number;
    imports: number;
    chunks: number;
    testLinks: number;
  };
}

function extOf(file: string): string {
  const idx = file.lastIndexOf('.');
  return idx === -1 ? '' : file.slice(idx);
}

function isTestFile(path: string): boolean {
  return /(^|[/\\])(__tests__|tests?)([/\\])/.test(path) || /\.(test|spec)\.[^.]+$/.test(path);
}

function collectFiles(cwd: string): RepoFile[] {
  const files: RepoFile[] = [];

  const walk = (dir: string) => {
    for (const entry of safeReadDir(dir)) {
      if (isIgnoredDirName(entry)) continue;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }

      const ext = extOf(entry);
      const rel = relative(cwd, full);
      if (isGeneratedArtifact(rel)) continue;
      if (shouldExcludePath(rel).excluded) continue;
      if (!SOURCE_EXTS.has(ext) || st.size > MAX_FILE_SIZE) continue;
      const text = safeRead(full);
      files.push({
        path: rel,
        ext,
        loc: text ? text.split('\n').length : 0,
        bytes: st.size,
        isTest: isTestFile(rel),
      });
    }
  };

  walk(cwd);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function safeReadDir(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

function safeRead(file: string): string {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}

function detectSymbols(file: RepoFile, text: string): RepoSymbol[] {
  const symbols: RepoSymbol[] = [];
  const lines = text.split('\n');
  const patterns: Array<[RepoSymbol['kind'], RegExp]> = [
    ['class', /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/],
    ['function', /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/],
    ['const', /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/],
    ['method', /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/],
    ['function', /^\s*def\s+([A-Za-z_]\w*)\s*\(/],
    ['class', /^\s*class\s+([A-Za-z_]\w*)/],
  ];

  lines.forEach((line, index) => {
    for (const [kind, pattern] of patterns) {
      const match = pattern.exec(line);
      if (!match?.[1]) continue;
      symbols.push({ name: match[1], kind, file: file.path, line: index + 1 });
      return;
    }
  });

  return symbols.slice(0, 200);
}

function detectImports(file: RepoFile, text: string, allFiles: Set<string>): RepoImport[] {
  const imports: RepoImport[] = [];
  const patterns = [
    /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\(['"]([^'"]+)['"]\)/g,
    /^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+/gm,
    /^\s*import\s+([A-Za-z_][\w.]*)/gm,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier) continue;
      imports.push({ from: file.path, specifier, resolved: resolveImport(file.path, specifier, allFiles) });
    }
  }

  return imports.slice(0, 200);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildChunks(file: RepoFile, text: string, symbols: RepoSymbol[]): RepoChunk[] {
  const lines = text.split('\n');
  const fileSymbols = symbols.filter((symbol) => symbol.file === file.path);
  if (fileSymbols.length === 0) return lineChunks(file, lines);

  return fileSymbols.slice(0, 120).map((symbol, index) => {
    const next = fileSymbols[index + 1];
    const startLine = symbol.line;
    const endLine = Math.min(next ? next.line - 1 : startLine + 80, lines.length);
    const slice = lines.slice(startLine - 1, endLine).join('\n');
    return {
      file: file.path,
      name: symbol.name,
      type: symbol.kind === 'const' || symbol.kind === 'unknown' ? 'block' : symbol.kind,
      startLine,
      endLine,
      tokens: estimateTokens(slice),
    };
  });
}

function lineChunks(file: RepoFile, lines: string[]): RepoChunk[] {
  const chunks: RepoChunk[] = [];
  for (let i = 0; i < lines.length; i += 120) {
    const end = Math.min(i + 120, lines.length);
    chunks.push({
      file: file.path,
      name: `lines ${i + 1}-${end}`,
      type: 'block',
      startLine: i + 1,
      endLine: end,
      tokens: estimateTokens(lines.slice(i, end).join('\n')),
    });
  }
  return chunks;
}

function resolveImport(from: string, specifier: string, allFiles: Set<string>): string | undefined {
  // TypeScript ESM uses .js extensions for .ts files — strip and retry
  const normalized = specifier.replace(/\.js$/, '');

  if (normalized.startsWith('.') || normalized.startsWith('/')) {
    const base = join(dirname(from), normalized);
    const candidates = [
      base,
      `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.py`,
      join(base, 'index.ts'), join(base, 'index.tsx'), join(base, 'index.js'),
    ];
    return candidates.find((c) => allFiles.has(c));
  }

  // Python absolute import: agents.foo → agents/foo.py or agents/foo/__init__.py
  if (/^[A-Za-z_][\w.]*$/.test(normalized)) {
    const asPath = normalized.replace(/\./g, '/');
    const candidates = [
      `${asPath}.py`,
      `${asPath}/__init__.py`,
      // also try from same directory as importer
      join(dirname(from), `${asPath}.py`),
      join(dirname(from), `${asPath}/__init__.py`),
    ];
    return candidates.find((c) => allFiles.has(c));
  }

  return undefined;
}

function mapTests(files: RepoFile[]): TestLink[] {
  const tests = files.filter((f) => f.isTest);
  const sources = files.filter((f) => !f.isTest);
  const links: TestLink[] = [];

  for (const source of sources) {
    const stem = source.path.replace(/\.[^.]+$/, '').split('/').pop() ?? source.path;
    const related = tests
      .filter((test) => test.path.includes(stem) || sameDirectory(source.path, test.path))
      .map((test) => test.path)
      .slice(0, 20);
    if (related.length > 0) links.push({ source: source.path, tests: related });
  }

  return links;
}

function sameDirectory(a: string, b: string): boolean {
  return dirname(a) === dirname(b);
}

export async function buildRepoIndex(cwd: string): Promise<RepoIndex> {
  const files = collectFiles(cwd);
  const fileSet = new Set(files.map((f) => f.path));
  const symbols: RepoSymbol[] = [];
  const imports: RepoImport[] = [];
  const chunks: RepoChunk[] = [];

  for (const file of files) {
    const full = join(cwd, file.path);
    const text = safeRead(full);
    const fileSymbols = detectSymbols(file, text);
    symbols.push(...fileSymbols);
    imports.push(...detectImports(file, text, fileSet));

    // Use AST chunker (tree-sitter for TS/JS, line-based fallback for others)
    try {
      const codeChunks = await chunkFile(full);
      chunks.push(...codeChunks.map((c) => ({
        file: file.path,
        name: c.name ?? 'anonymous',
        type: c.type as RepoChunk['type'],
        startLine: c.startLine,
        endLine: c.endLine,
        tokens: c.tokens,
      })));
    } catch {
      // Fallback to line chunks if AST fails for this file
      chunks.push(...lineChunks(file, text.split('\n')));
    }
  }

  const tests = mapTests(files);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: cwd,
    files,
    symbols,
    imports,
    chunks,
    tests,
    stats: {
      files: files.length,
      symbols: symbols.length,
      imports: imports.length,
      chunks: chunks.length,
      testLinks: tests.length,
    },
  };
}

export function writeRepoIndex(cwd: string, index: RepoIndex): string {
  const path = join(cwd, AI_RUNTIME_DIR, 'repo-index.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(index, null, 2), 'utf8');
  return path;
}
