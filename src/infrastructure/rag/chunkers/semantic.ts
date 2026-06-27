export interface ChunkerOptions {
  maxChunkLines: number;
  overlapLines: number;
}

const DEFAULT_OPTS: ChunkerOptions = {
  maxChunkLines: 50,
  overlapLines: 5,
};

const TS_KEYWORDS = /\b(function|const|let|var|class|interface|type|enum|export|import|if|for|while|switch|return|async|await)\b/g;
const SECTION_HEADERS = /^(#+\s|={3,}|-{3,}|\/\*\*)/;

export interface CodeChunk {
  text: string;
  startLine: number;
  endLine: number;
  type: 'function' | 'class' | 'block' | 'section' | 'paragraph' | 'fallback';
}

export function chunkMarkdown(text: string, opts: Partial<ChunkerOptions> = {}): CodeChunk[] {
  const { maxChunkLines, overlapLines } = { ...DEFAULT_OPTS, ...opts };
  const lines = text.split('\n');
  const chunks: CodeChunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]?.match(SECTION_HEADERS)) {
      let end = i + 1;
      while (end < lines.length && !lines[end]?.match(SECTION_HEADERS)) end++;
      const segment = lines.slice(i, end);
      if (segment.length > maxChunkLines) {
        for (let j = 0; j < segment.length; j += maxChunkLines - overlapLines) {
          const slice = segment.slice(j, Math.min(j + maxChunkLines, segment.length));
          chunks.push({
            text: slice.join('\n'),
            startLine: i + j + 1,
            endLine: i + Math.min(j + maxChunkLines, segment.length),
            type: 'section',
          });
        }
      } else {
        chunks.push({
          text: segment.join('\n'),
          startLine: i + 1,
          endLine: i + segment.length,
          type: 'section',
        });
      }
      i = end;
    } else {
      i++;
    }
  }
  if (chunks.length === 0) {
    for (let j = 0; j < lines.length; j += maxChunkLines - overlapLines) {
      const slice = lines.slice(j, Math.min(j + maxChunkLines, lines.length));
      chunks.push({
        text: slice.join('\n'),
        startLine: j + 1,
        endLine: Math.min(j + maxChunkLines, lines.length),
        type: 'paragraph',
      });
    }
  }
  return chunks;
}

export function chunkTypeScript(text: string, opts: Partial<ChunkerOptions> = {}): CodeChunk[] {
  const { maxChunkLines, overlapLines } = { ...DEFAULT_OPTS, ...opts };
  const lines = text.split('\n');
  const chunks: CodeChunk[] = [];
  let buffer: string[] = [];
  let bufferStart = 0;
  let parenDepth = 0;
  let braceDepth = 0;

  const flush = (endLine: number, type: CodeChunk['type']) => {
    if (buffer.length === 0) return;
    chunks.push({
      text: buffer.join('\n'),
      startLine: bufferStart + 1,
      endLine,
      type,
    });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    buffer.push(line);
    for (const ch of line) {
      if (ch === '(' || ch === '[') parenDepth++;
      else if (ch === ')' || ch === ']') parenDepth--;
      else if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
    }

    const isFunctionDecl = /^(export\s+)?(async\s+)?function\s+\w+/.test(line.trim()) ||
                          /^(export\s+)?(const|let)\s+\w+\s*=\s*(async\s+)?\(/.test(line.trim());
    const isClassDecl = /^(export\s+)?(abstract\s+)?class\s+\w+/.test(line.trim());

    if (isFunctionDecl || isClassDecl) {
      if (braceDepth > 0 && parenDepth === 0) {
        const closeBrace = findMatchingBrace(lines, i);
        if (closeBrace > i) {
          buffer = lines.slice(i, closeBrace + 1);
          chunks.push({
            text: buffer.join('\n'),
            startLine: i + 1,
            endLine: closeBrace + 1,
            type: isClassDecl ? 'class' : 'function',
          });
          buffer = [];
          i = closeBrace;
          braceDepth = 0;
          continue;
        }
      }
    }

    if (buffer.length >= maxChunkLines) {
      flush(i + 1, 'block');
      const overlap = Math.min(overlapLines, buffer.length);
      buffer = lines.slice(Math.max(0, i - overlap + 1), i + 1);
      bufferStart = i - overlap + 1;
    }
  }

  flush(lines.length, 'block');
  return chunks;
}

function findMatchingBrace(lines: string[], start: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i] ?? '') {
      if (inString) {
        if (ch === '\\') { i++; continue; }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

export function chunkByLines(text: string, opts: Partial<ChunkerOptions> = {}): CodeChunk[] {
  const { maxChunkLines, overlapLines } = { ...DEFAULT_OPTS, ...opts };
  const lines = text.split('\n');
  const chunks: CodeChunk[] = [];
  for (let i = 0; i < lines.length; i += maxChunkLines - overlapLines) {
    const slice = lines.slice(i, Math.min(i + maxChunkLines, lines.length));
    chunks.push({
      text: slice.join('\n'),
      startLine: i + 1,
      endLine: Math.min(i + maxChunkLines, lines.length),
      type: 'fallback',
    });
  }
  return chunks;
}

export interface Chunker {
  chunk(text: string, opts?: Partial<ChunkerOptions>): CodeChunk[];
}

export class MarkdownChunker implements Chunker {
  chunk(text: string, opts?: Partial<ChunkerOptions>): CodeChunk[] {
    return chunkMarkdown(text, opts);
  }
}

export class TypeScriptChunker implements Chunker {
  chunk(text: string, opts?: Partial<ChunkerOptions>): CodeChunk[] {
    return chunkTypeScript(text, opts);
  }
}

export class LineChunker implements Chunker {
  chunk(text: string, opts?: Partial<ChunkerOptions>): CodeChunk[] {
    return chunkByLines(text, opts);
  }
}

export function chunkerForPath(filePath: string): Chunker {
  if (/\.(ts|tsx|js|jsx)$/.test(filePath)) return new TypeScriptChunker();
  if (/\.(md|mdx)$/.test(filePath)) return new MarkdownChunker();
  return new LineChunker();
}