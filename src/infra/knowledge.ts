import { join } from 'path';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

type KnowledgeCategory = 'architecture' | 'bugs' | 'features' | 'decisions' | 'patterns';

const CATEGORIES: KnowledgeCategory[] = [
  'architecture',
  'bugs',
  'features',
  'decisions',
  'patterns',
];

const MAX_CONTEXT_CHARS = 8000;

export class KnowledgeStore {
  private readonly root: string;

  constructor(cwd: string) {
    this.root = join(cwd, '.ai-memory');
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

  // At MVP: concatenate all categories up to MAX_CONTEXT_CHARS.
  // Phase 2 will replace this with Qdrant semantic search without changing the signature.
  buildContext(_query: string): string {
    const parts: string[] = [];
    let total = 0;

    for (const cat of CATEGORIES) {
      const text = this.readCategory(cat);
      if (!text) continue;
      const section = `## ${cat}\n\n${text}`;
      if (total + section.length > MAX_CONTEXT_CHARS) break;
      parts.push(section);
      total += section.length;
    }

    return parts.join('\n\n');
  }
}
