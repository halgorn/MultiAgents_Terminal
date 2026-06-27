export interface ScoredId {
  id: string;
  score: number;
}

export interface VectorIndex {
  readonly type: 'flat' | 'ivf' | 'hnsw';
  readonly dim: number;
  size(): number;
  insert(id: string, vec: Float32Array): void;
  search(query: Float32Array, k: number): ScoredId[];
  persist(path: string): Promise<void>;
  load(path: string): Promise<void>;
}

export class FlatVectorIndex implements VectorIndex {
  readonly type = 'flat' as const;
  readonly dim: number;
  private readonly ids: string[] = [];
  private readonly vectors: Float32Array[] = [];

  constructor(dim: number) {
    this.dim = dim;
  }

  size(): number {
    return this.ids.length;
  }

  insert(id: string, vec: Float32Array): void {
    if (vec.length !== this.dim) {
      throw new Error(`FlatVectorIndex: dim mismatch (got ${vec.length}, expected ${this.dim})`);
    }
    this.ids.push(id);
    this.vectors.push(vec);
  }

  search(query: Float32Array, k: number): ScoredId[] {
    if (query.length !== this.dim) {
      throw new Error(`FlatVectorIndex: query dim mismatch`);
    }
    const scored: ScoredId[] = this.ids.map((id, i) => ({
      id,
      score: cosineSimilarity(query, this.vectors[i]!),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, k));
  }

  async persist(path: string): Promise<void> {
    const { writeFileSync, mkdirSync } = await import('fs');
    const { dirname } = await import('path');
    mkdirSync(dirname(path), { recursive: true });
    const buffer = serializeFlatIndex(this.ids, this.vectors, this.dim);
    writeFileSync(path, buffer);
  }

  async load(path: string): Promise<void> {
    const { readFileSync, existsSync } = await import('fs');
    if (!existsSync(path)) {
      this.ids.length = 0;
      this.vectors.length = 0;
      return;
    }
    const buffer = readFileSync(path);
    const { ids, vectors, dim } = deserializeFlatIndex(buffer);
    if (dim !== this.dim) {
      throw new Error(`FlatVectorIndex: loaded dim ${dim} != expected ${this.dim}`);
    }
    this.ids.length = 0;
    this.vectors.length = 0;
    this.ids.push(...ids);
    this.vectors.push(...vectors);
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function serializeFlatIndex(ids: string[], vectors: Float32Array[], dim: number): Buffer {
  const idBytes = ids.map((id) => Buffer.from(id, 'utf8'));
  const idOffsets: number[] = [];
  let idOffset = 0;
  for (const b of idBytes) {
    idOffsets.push(idOffset);
    idOffset += b.length;
  }
  const idSectionSize = 8 + ids.length * (4 + 4) + idOffset;
  const vecSectionSize = 8 + ids.length * (4 + dim * 4);
  const total = 8 + 4 + idSectionSize + vecSectionSize;
  const buf = Buffer.alloc(total);
  let p = 0;
  buf.writeUInt32LE(dim, p); p += 4;
  buf.writeUInt32LE(ids.length, p); p += 4;
  buf.writeUInt32LE(0xa1, p); p += 4;
  buf.writeUInt32LE(0xb2, p); p += 4;
  for (let i = 0; i < ids.length; i++) {
    buf.writeUInt32LE(idOffsets[i]!, p); p += 4;
    buf.writeUInt32LE(idBytes[i]!.length, p); p += 4;
  }
  for (const b of idBytes) {
    b.copy(buf, p); p += b.length;
  }
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      buf.writeFloatLE(v[i]!, p); p += 4;
    }
  }
  return buf;
}

export function deserializeFlatIndex(buf: Buffer): { ids: string[]; vectors: Float32Array[]; dim: number } {
  let p = 0;
  const dim = buf.readUInt32LE(p); p += 4;
  const count = buf.readUInt32LE(p); p += 4;
  const magic1 = buf.readUInt32LE(p); p += 4;
  const magic2 = buf.readUInt32LE(p); p += 4;
  if (magic1 !== 0xa1 || magic2 !== 0xb2) {
    throw new Error('FlatVectorIndex: bad magic bytes');
  }
  const ids: string[] = [];
  const idOffsets: number[] = [];
  const idLengths: number[] = [];
  for (let i = 0; i < count; i++) {
    idOffsets.push(buf.readUInt32LE(p)); p += 4;
    idLengths.push(buf.readUInt32LE(p)); p += 4;
  }
  const idBase = p;
  for (let i = 0; i < count; i++) {
    const start = idBase + idOffsets[i]!;
    ids.push(buf.subarray(start, start + idLengths[i]!).toString('utf8'));
  }
  p = idBase + (idOffsets[idOffsets.length - 1] ?? 0) + (idLengths[idLengths.length - 1] ?? 0);
  const vectors: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const v = new Float32Array(dim);
    for (let j = 0; j < dim; j++) {
      v[j] = buf.readFloatLE(p); p += 4;
    }
    vectors.push(v);
  }
  return { ids, vectors, dim };
}