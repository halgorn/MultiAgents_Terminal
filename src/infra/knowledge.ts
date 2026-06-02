import { join } from 'path';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { EmbeddingStore } from './embeddings.js';
import { BM25Index, hybridScore } from './bm25.js';

type KnowledgeCategory = 'architecture' | 'bugs' | 'features' | 'decisions' | 'patterns';

const CATEGORIES: KnowledgeCategory[] = [
  'architecture',
  'bugs',
  'features',
  'decisions',
  'patterns',
];

const MAX_CONTEXT_CHARS = 8000;
const MAX_ENTRY_CHARS = 1800;

interface KnowledgeEntry {
  category: KnowledgeCategory;
  filename: string;
  text: string;
  score: number;
}

function keywords(query: string): string[] {
  return [...new Set(query
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((word) => word.length > 2))];
}

function scoreText(text: string, queryWords: string[]): number {
  const haystack = text.toLowerCase();
  return queryWords.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

export class KnowledgeStore {
  private readonly root: string;
  readonly embeddings: EmbeddingStore;

  constructor(cwd: string) {
    this.root = join(cwd, '.ai-memory');
    this.embeddings = new EmbeddingStore(this.root);
    this.ensureDirs();
  }

  private ensureDirs(): void {
    for (const cat of CATEGORIES) {
      mkdirSync(join(this.root, cat), { recursive: true });
    }
  }

  readCategory(category: KnowledgeCategory): string {
    const dir = join(this.root, category);
    if (!existsSync(dir)) return '';

    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    return files
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n\n---\n\n');
  }

  private readEntries(query: string): KnowledgeEntry[] {
    const queryWords = keywords(query);
    return CATEGORIES.flatMap((category) => {
      const dir = join(this.root, category);
      if (!existsSync(dir)) return [];

      return readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((filename) => {
          const text = readFileSync(join(dir, filename), 'utf8');
          return {
            category,
            filename,
            text: text.length > MAX_ENTRY_CHARS ? text.slice(0, MAX_ENTRY_CHARS) : text,
            score: scoreText(`${filename}\n${text}`, queryWords),
          };
        });
    });
  }

  writeEntry(category: KnowledgeCategory, title: string, content: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const ts = Date.now();
    const filename = `${ts}-${slug}.md`;
    const filepath = join(this.root, category, filename);
    writeFileSync(filepath, `# ${title}\n\n${content}\n`, 'utf8');
    return filepath;
  }

  buildContext(query: string): string {
    const parts: string[] = [];
    let total = 0;
    const entries = this.readEntries(query)
      .sort((a, b) => b.score - a.score || b.filename.localeCompare(a.filename));

    for (const entry of entries) {
      if (entry.score === 0 && parts.length > 0) continue;
      const section = `## ${entry.category}/${entry.filename}\n\n${entry.text}`;
      if (total + section.length > MAX_CONTEXT_CHARS) break;
      parts.push(section);
      total += section.length;
    }

    return parts.join('\n\n');
  }

  // Hybrid retrieval — BM25 + semantic embeddings when index exists, falls back to keyword
  async buildContextSemantic(query: string, topK = 5): Promise<string> {
    // Build BM25 index over all entries (fast, in-memory)
    const allEntries = this.readEntries(query);
    const bm25 = new BM25Index();
    for (const e of allEntries) bm25.add(`${e.category}/${e.filename}`, e.text);
    const bm25Results = bm25.score(query).slice(0, topK * 2);

    if (!this.embeddings.hasIndex()) {
      // BM25 only
      return bm25Results
        .slice(0, topK)
        .map(({ id }) => {
          const e = allEntries.find((x) => `${x.category}/${x.filename}` === id);
          return e ? `## ${id}\n\n${e.text}` : '';
        })
        .filter(Boolean)
        .join('\n\n');
    }

    // Hybrid: BM25 + vector cosine
    const vectorResults = await this.embeddings.query(query, topK * 2);
    const vecScores = vectorResults.map((r) => ({ id: `${r.category}/${r.filename}`, score: r.score }));
    const hybrid = hybridScore(bm25Results, vecScores, 0.5).slice(0, topK);

    return hybrid
      .map(({ id }) => {
        const e = allEntries.find((x) => `${x.category}/${x.filename}` === id);
        return e ? `## ${id}\n\n${e.text}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
}
