import { join } from 'path';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { EmbeddingStore } from './embeddings.js';

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

  // Semantic retrieval — uses embeddings when index exists, falls back to keyword
  async buildContextSemantic(query: string, topK = 5): Promise<string> {
    if (!this.embeddings.hasIndex()) {
      return this.buildContext(query);
    }

    const results = await this.embeddings.query(query, topK);
    if (results.length === 0) return this.buildContext(query);

    return results
      .map((r) => `## ${r.category}/${r.filename} (score: ${r.score.toFixed(3)})\n\n${r.text}`)
      .join('\n\n');
  }
}
