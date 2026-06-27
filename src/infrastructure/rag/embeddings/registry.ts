export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dim: number;
  readonly isConfigured: () => boolean;
  embedBatch(texts: readonly string[]): Promise<Float32Array[]>;
}

export interface EmbeddingRegistryEntry {
  id: string;
  envVars: readonly string[];
  factory: () => EmbeddingProvider | null;
  priority: number;
}

export class EmbeddingRegistry {
  private readonly entries = new Map<string, EmbeddingRegistryEntry>();

  register(entry: EmbeddingRegistryEntry): this {
    if (this.entries.has(entry.id)) {
      throw new Error(`EmbeddingRegistry: duplicate id "${entry.id}"`);
    }
    this.entries.set(entry.id, entry);
    return this;
  }

  resolve(id?: string): EmbeddingProvider {
    if (id) {
      const entry = this.entries.get(id);
      if (!entry) throw new Error(`EmbeddingRegistry: unknown id "${id}"`);
      const provider = entry.factory();
      if (!provider || !provider.isConfigured()) {
        throw new Error(
          `EmbeddingRegistry: provider "${id}" not configured (needs ${entry.envVars.join(' or ')})`,
        );
      }
      return provider;
    }
    const sorted = Array.from(this.entries.values()).sort((a, b) => a.priority - b.priority);
    for (const entry of sorted) {
      const provider = entry.factory();
      if (provider && provider.isConfigured()) return provider;
    }
    throw new Error(
      'EmbeddingRegistry: no configured provider. Set VOYAGE_API_KEY, OPENAI_API_KEY, or configure a local provider.',
    );
  }

  list(): readonly EmbeddingRegistryEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => a.priority - b.priority);
  }

  configured(): readonly EmbeddingProvider[] {
    const result: EmbeddingProvider[] = [];
    for (const entry of this.list()) {
      const p = entry.factory();
      if (p && p.isConfigured()) result.push(p);
    }
    return result;
  }
}

export const HASH_FALLBACK_DIM = 384;

export class HashFallbackProvider implements EmbeddingProvider {
  readonly id = 'hash-fallback';
  readonly model = `hash-${HASH_FALLBACK_DIM}`;
  readonly dim = HASH_FALLBACK_DIM;

  isConfigured(): boolean {
    return true;
  }

  async embedBatch(texts: readonly string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.hash(t));
  }

  private hash(text: string): Float32Array {
    const vec = new Float32Array(this.dim);
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    for (let i = 0; i < this.dim; i++) {
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      vec[i] = ((h1 >>> 0) / 0xffffffff - 0.5) * 2;
    }
    return vec;
  }
}