import { readFileSync } from 'fs';

// Lazy-load Tree-sitter to avoid startup cost
let _Parser: typeof import('tree-sitter') | null = null;
let _ts: { typescript: unknown; tsx: unknown } | null = null;

async function getParser(ext: string): Promise<import('tree-sitter') | null> {
  if (!['.ts', '.tsx'].includes(ext)) return null;

  try {
    if (!_Parser) {
      const TreeSitter = await import('tree-sitter');
      _Parser = TreeSitter.default as unknown as typeof import('tree-sitter');
    }
    if (!_ts) {
      const tsmod = await import('tree-sitter-typescript');
      _ts = tsmod.default as { typescript: unknown; tsx: unknown };
    }

    const parser = new (_Parser as unknown as new () => {
      setLanguage(lang: unknown): void;
      parse(src: string): { rootNode: TSNode };
    })();

    parser.setLanguage(ext === '.tsx' ? _ts.tsx : _ts.typescript);
    return parser as unknown as import('tree-sitter');
  } catch {
    // tree-sitter not available for this extension
  }
  return null;
}

interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number };
  endPosition: { row: number };
  children: TSNode[];
  namedChildren: TSNode[];
}

export interface CodeChunk {
  file: string;
  type: 'function' | 'class' | 'method' | 'block';
  name: string;
  startLine: number;
  endLine: number;
  text: string;
  tokens: number; // rough estimate
}

// Node types that represent meaningful code units
const CHUNK_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'class_declaration',
  'class_expression',
  'export_statement',
  'lexical_declaration',
  'variable_declaration',
]);

function estimateTokens(text: string): number {
  // ~4 chars per token for code
  return Math.ceil(text.length / 4);
}

function extractName(node: TSNode): string {
  for (const child of node.namedChildren) {
    if (child.type === 'identifier' || child.type === 'property_identifier') {
      return child.text;
    }
  }
  return '(anonymous)';
}

function nodeToChunkType(type: string): CodeChunk['type'] {
  if (type.includes('class')) return 'class';
  if (type.includes('method')) return 'method';
  if (type.includes('function') || type.includes('arrow')) return 'function';
  return 'block';
}

function extractChunks(node: TSNode, file: string, chunks: CodeChunk[]): void {
  if (CHUNK_TYPES.has(node.type)) {
    const text = node.text;
    const lines = node.endPosition.row - node.startPosition.row + 1;

    // Skip tiny declarations (< 3 lines) — not meaningful chunks
    if (lines >= 3) {
      chunks.push({
        file,
        type: nodeToChunkType(node.type),
        name: extractName(node),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        text,
        tokens: estimateTokens(text),
      });
      return; // don't recurse into already-chunked nodes
    }
  }

  for (const child of node.namedChildren) {
    extractChunks(child, file, chunks);
  }
}

/**
 * Parse a source file into structural chunks using Tree-sitter.
 * Falls back to line-based chunking when Tree-sitter unavailable.
 */
export async function chunkFile(filePath: string, maxTokensPerChunk = 1500): Promise<CodeChunk[]> {
  let source: string;
  try {
    source = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const ext = filePath.match(/\.[^.]+$/)?.[0] ?? '';
  const parser = await getParser(ext);

  if (parser) {
    try {
      const tree = (parser as unknown as { parse(s: string): { rootNode: TSNode } }).parse(source);
      const chunks: CodeChunk[] = [];
      extractChunks(tree.rootNode, filePath, chunks);

      // Split oversized chunks by lines
      return chunks.flatMap((chunk) => {
        if (chunk.tokens <= maxTokensPerChunk) return [chunk];
        return splitChunkByLines(chunk, maxTokensPerChunk);
      });
    } catch {
      // Tree-sitter parse failed — fall through to line-based
    }
  }

  // Fallback: line-based chunks
  return lineBasedChunks(filePath, source, maxTokensPerChunk);
}

function splitChunkByLines(chunk: CodeChunk, maxTokens: number): CodeChunk[] {
  const lines = chunk.text.split('\n');
  const linesPerChunk = Math.max(10, Math.floor(maxTokens / 5)); // ~5 tokens/line
  const result: CodeChunk[] = [];

  for (let i = 0; i < lines.length; i += linesPerChunk) {
    const slice = lines.slice(i, i + linesPerChunk).join('\n');
    result.push({
      ...chunk,
      name: `${chunk.name}[${i + 1}-${Math.min(i + linesPerChunk, lines.length)}]`,
      startLine: chunk.startLine + i,
      endLine: chunk.startLine + Math.min(i + linesPerChunk, lines.length) - 1,
      text: slice,
      tokens: estimateTokens(slice),
    });
  }
  return result;
}

function lineBasedChunks(filePath: string, source: string, maxTokens: number): CodeChunk[] {
  const linesPerChunk = Math.max(20, Math.floor(maxTokens / 5));
  const lines = source.split('\n');
  const chunks: CodeChunk[] = [];

  for (let i = 0; i < lines.length; i += linesPerChunk) {
    const slice = lines.slice(i, i + linesPerChunk).join('\n');
    chunks.push({
      file: filePath,
      type: 'block',
      name: `lines ${i + 1}-${Math.min(i + linesPerChunk, lines.length)}`,
      startLine: i + 1,
      endLine: Math.min(i + linesPerChunk, lines.length),
      text: slice,
      tokens: estimateTokens(slice),
    });
  }
  return chunks;
}

/**
 * Get a context-relevant excerpt around a specific line.
 * Used by agents to read targeted sections without loading full files.
 */
export async function getChunkAroundLine(
  filePath: string,
  targetLine: number,
  contextLines = 30,
): Promise<string> {
  try {
    const source = readFileSync(filePath, 'utf8');
    const lines = source.split('\n');
    const start = Math.max(0, targetLine - contextLines - 1);
    const end = Math.min(lines.length, targetLine + contextLines);
    return lines.slice(start, end).join('\n');
  } catch {
    return '';
  }
}
