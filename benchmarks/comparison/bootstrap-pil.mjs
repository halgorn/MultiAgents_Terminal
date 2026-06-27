#!/usr/bin/env node
// Helper to bootstrap a PIL v2 for testing — splits source into chunks and runs embedding.
// Usage: node benchmarks/comparison/bootstrap-pil.mjs [target-dir]

import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { HashFallbackProvider } from '../../dist/infrastructure/rag/embeddings/registry.js';
import { FlatVectorIndex } from '../../dist/infrastructure/rag/vectors/index.js';

const ROOT = process.argv[2] ?? process.cwd();
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.kt']);
const MAX_BYTES = 200 * 1024;
const CHUNK_LINES = 50;

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage' || entry.name === 'benchmarks') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    const ext = '.' + entry.name.split('.').pop();
    if (!SOURCE_EXTS.has(ext)) continue;
    try {
      const st = statSync(full);
      if (st.size > MAX_BYTES) continue;
      files.push({ full, rel: relative(ROOT, full), text: readFileSync(full, 'utf8') });
    } catch {}
  }
}
walk(ROOT);
console.log(`Indexing ${files.length} source files...`);

const provider = new HashFallbackProvider();
const dim = provider.dim;
const idx = new FlatVectorIndex(dim);

const chunks = [];
for (const f of files) {
  const lines = f.text.split('\n');
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const text = lines.slice(i, i + CHUNK_LINES).join('\n');
    if (text.trim().length < 20) continue;
    chunks.push({ id: `${f.rel}:${i + 1}`, text, file: f.rel, startLine: i + 1 });
  }
}
console.log(`Created ${chunks.length} chunks.`);

const BATCH = 32;
let embedded = 0;
for (let i = 0; i < chunks.length; i += BATCH) {
  const batch = chunks.slice(i, i + BATCH);
  const vecs = await provider.embedBatch(batch.map((c) => c.text));
  for (let j = 0; j < batch.length; j++) idx.insert(batch[j].id, vecs[j]);
  embedded += batch.length;
  if (embedded % 100 === 0 || embedded === chunks.length) process.stdout.write(`\r  Embedded ${embedded}/${chunks.length}`);
}
process.stdout.write('\n');

mkdirSync(join(ROOT, '.ai-runtime', 'pil'), { recursive: true });
await idx.persist(join(ROOT, '.ai-runtime', 'pil', 'vectors.bin'));
writeFileSync(join(ROOT, '.ai-runtime', 'pil', 'manifest.json'), JSON.stringify({
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  root: ROOT,
  repoHash: 'bootstrap',
  fileCount: files.length,
  chunkCount: chunks.length,
  embeddings: { providerId: 'hash-fallback', modelId: 'hash-384', dim, indexType: 'flat', vectorsPath: 'pil/vectors.bin', count: chunks.length, norm: 'l2' },
}, null, 2), 'utf8');

console.log(`\n✓ PIL ready at ${ROOT}/.ai-runtime/pil/`);
console.log(`  ${chunks.length} chunks, ${dim}-d vectors, ${files.length} files indexed.`);