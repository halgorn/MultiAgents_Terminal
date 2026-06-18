import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runSync } from './sync.js';
import { renderProjectMarkdown, writeProjectMarkdown, runWiki, renderModuleMarkdown, renderDomainMarkdown, writeDocFile, runWikiBatch } from './wiki.js';
import { writeProjectStore } from '../../infra/project-store.js';
import type { ProjectStore } from '../../infra/project-store.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'aion-wiki-'));
}

function writeFile(p: string, content: string): void {
  const dir = p.substring(0, p.lastIndexOf('/'));
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(p, content);
}

function makeFixture(cwd: string): void {
  writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*'] }));
  writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.1' }));
  writeFile(join(cwd, 'src/a.ts'),
    `export function hello(): string {\n  const greeting = 'hi';\n  return greeting;\n}\n`);
  writeFile(join(cwd, 'src/b.ts'),
    `import { hello } from './a.js';\nexport function greet(): string {\n  const out = hello() + '!';\n  return out;\n}\n`);
}

function makeStore(cwd: string): ProjectStore {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: cwd,
    repoHash: 'abc123',
    files: [
      { path: 'src/a.ts', ext: '.ts', loc: 5, bytes: 100, isTest: false },
      { path: 'src/b.ts', ext: '.ts', loc: 5, bytes: 120, isTest: false },
      { path: 'src/c.test.ts', ext: '.ts', loc: 5, bytes: 80, isTest: true },
    ],
    symbols: [
      { name: 'hello', kind: 'function', file: 'src/a.ts', line: 1 },
      { name: 'greet', kind: 'function', file: 'src/b.ts', line: 1 },
    ],
    imports: [{ from: 'src/b.ts', specifier: './a.js', resolved: 'src/a.ts' }],
    chunks: [{ file: 'src/a.ts', name: 'hello', type: 'function', startLine: 1, endLine: 5, tokens: 25 }],
    tests: [{ source: 'src/a.ts', tests: ['src/c.test.ts'] }],
    embeddings: { model: 'Xenova/test', dim: 384, vectorsPath: 'project.vectors.bin', count: 1 },
    deps: {
      nodes: [
        { file: 'src/a.ts', imports: [], importedBy: ['src/b.ts'], exports: ['hello'], loc: 5 },
        { file: 'src/b.ts', imports: ['src/a.ts'], importedBy: [], exports: ['greet'], loc: 5 },
      ],
      cycles: [],
      hotspots: [{ file: 'src/a.ts', fanIn: 1, fanOut: 0, score: 5 }],
    },
    stats: {
      files: 3, symbols: 2, imports: 1, chunks: 1, testLinks: 1,
      vectors: 1, modules: 2, cycles: 0, durationMs: 50,
    },
  };
}

test('renderProjectMarkdown includes all standard sections', () => {
  const cwd = '/tmp/x';
  const store = makeStore(cwd);
  const { md, sections } = renderProjectMarkdown(store);
  assert.ok(sections.includes('Overview'));
  assert.ok(sections.includes('Hotspots (high coupling)'));
  assert.ok(sections.includes('Test Coverage'));
  assert.match(md, /^# .* — Project Index/m);
  assert.match(md, /## Overview/);
});

test('renderProjectMarkdown shows cycles when present', () => {
  const cwd = '/tmp/y';
  const store = makeStore(cwd);
  store.deps.cycles = [['src/a.ts', 'src/b.ts', 'src/a.ts']];
  const { md, sections } = renderProjectMarkdown(store);
  assert.ok(sections.includes('Circular Dependencies'));
  assert.match(md, /src\/a\.ts.*src\/b\.ts.*src\/a\.ts/s);
});

test('renderProjectMarkdown hides cycles section when empty', () => {
  const cwd = '/tmp/z';
  const store = makeStore(cwd);
  store.deps.cycles = [];
  const { sections } = renderProjectMarkdown(store);
  assert.ok(!sections.includes('Circular Dependencies'));
});

test('renderProjectMarkdown includes embeddings section when count > 0', () => {
  const cwd = '/tmp/e';
  const store = makeStore(cwd);
  const { sections, md } = renderProjectMarkdown(store);
  assert.ok(sections.includes('Embeddings'));
  assert.match(md, /Xenova\/test/);
});

test('renderProjectMarkdown hides embeddings section when count = 0', () => {
  const cwd = '/tmp/f';
  const store = makeStore(cwd);
  store.embeddings.count = 0;
  const { sections } = renderProjectMarkdown(store);
  assert.ok(!sections.includes('Embeddings'));
});

test('renderProjectMarkdown estimates token count', () => {
  const cwd = '/tmp/g';
  const store = makeStore(cwd);
  const { estimatedTokens } = renderProjectMarkdown(store);
  assert.ok(estimatedTokens > 0);
  assert.ok(estimatedTokens < 10000, `expected reasonable size, got ${estimatedTokens}`);
});

test('renderProjectMarkdown respects token budget', () => {
  const cwd = '/tmp/h';
  const store = makeStore(cwd);
  const { estimatedTokens, sections } = renderProjectMarkdown(store, 200);
  assert.ok(estimatedTokens <= 200, `expected <=200, got ${estimatedTokens}`);
  assert.ok(sections.length < 10);
});

test('renderProjectMarkdown shows test coverage percentage', () => {
  const cwd = '/tmp/i';
  const store = makeStore(cwd);
  const { md } = renderProjectMarkdown(store);
  assert.match(md, /Coverage.*%/);
});

test('writeProjectMarkdown creates directory if needed', () => {
  const cwd = makeTmp();
  try {
    const out = join(cwd, 'sub', 'PROJECT.md');
    writeProjectMarkdown(cwd, '# test', out);
    assert.ok(existsSync(out));
    assert.equal(readFileSync(out, 'utf8'), '# test');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeProjectMarkdown defaults to .ai-runtime/PROJECT.md', () => {
  const cwd = makeTmp();
  try {
    writeProjectMarkdown(cwd, '# default');
    const path = join(cwd, '.ai-runtime', 'PROJECT.md');
    assert.ok(existsSync(path));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWiki auto-syncs when no project.json exists', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    const result = await runWiki({ cwd, tokenBudget: 8000 });
    assert.ok(result.path);
    assert.ok(existsSync(result.path));
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWiki with refresh=true runs sync first', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    const result = await runWiki({ cwd, refresh: true, tokenBudget: 8000 });
    assert.ok(result.path);
    assert.ok(existsSync(result.path));
    assert.ok(result.bytes > 0);
    assert.ok(result.sections.length > 0);
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWiki uses existing project.json if fresh', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    await runSync(cwd, { skipEmbeddings: true, quiet: true });
    const result = await runWiki({ cwd, tokenBudget: 8000 });
    assert.ok(result.path);
    assert.ok(result.bytes > 0);
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWiki writes to custom output path', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    const customPath = join(cwd, 'docs', 'INDEX.md');
    const result = await runWiki({ cwd, refresh: true, output: customPath, tokenBudget: 8000 });
    assert.equal(result.path, customPath);
    assert.ok(existsSync(customPath));
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWiki output contains root path', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    const result = await runWiki({ cwd, refresh: true, tokenBudget: 8000 });
    const content = readFileSync(result.path, 'utf8');
    assert.match(content, /Root.*tmp/);
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWiki output lists hotspots', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    const result = await runWiki({ cwd, refresh: true, tokenBudget: 8000 });
    const content = readFileSync(result.path, 'utf8');
    assert.match(content, /Hotspots/);
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWiki output contains usage instructions', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    const result = await runWiki({ cwd, refresh: true, tokenBudget: 8000 });
    const content = readFileSync(result.path, 'utf8');
    assert.match(content, /aion sync/);
    assert.match(content, /aion search/);
    assert.match(content, /aion chat/);
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('renderProjectMarkdown groups symbols by file', () => {
  const cwd = '/tmp/j';
  const store = makeStore(cwd);
  const { md } = renderProjectMarkdown(store);
  assert.match(md, /Symbols by File/);
  assert.match(md, /src\/a\.ts/);
});

test('renderProjectMarkdown handles empty store gracefully', () => {
  const cwd = '/tmp/k';
  const store = makeStore(cwd);
  store.files = [];
  store.symbols = [];
  store.chunks = [];
  store.deps.nodes = [];
  store.deps.hotspots = [];
  store.tests = [];
  const { md, sections } = renderProjectMarkdown(store);
  assert.ok(md.length > 0);
  assert.ok(sections.includes('Overview'));
  assert.ok(sections.includes('Test Coverage'));
});

test('writeProjectStore + renderProjectMarkdown roundtrip', async () => {
  const cwd = makeTmp();
  try {
    const store = makeStore(cwd);
    writeProjectStore(cwd, store);
    const { md } = renderProjectMarkdown(store);
    assert.match(md, new RegExp(store.root));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('renderModuleMarkdown produces per-module doc', () => {
  const cwd = '/tmp/x';
  const store = makeStore(cwd);
  const md = renderModuleMarkdown(store, 'src/a.ts');
  assert.match(md, /# Module: src\/a\.ts/);
  assert.match(md, /hello/);
  assert.match(md, /audience: both/);
});

test('renderModuleMarkdown handles missing module', () => {
  const store = makeStore('/tmp/x');
  const md = renderModuleMarkdown(store, 'src/nonexistent.ts');
  assert.match(md, /not in dependency graph/);
});

test('renderDomainMarkdown for architecture lists modules', () => {
  const store = makeStore('/tmp/x');
  const md = renderDomainMarkdown(store, 'architecture');
  assert.match(md, /# architecture/);
  assert.match(md, /Modules/);
});

test('renderDomainMarkdown for security is user-only', () => {
  const store = makeStore('/tmp/x');
  const md = renderDomainMarkdown(store, 'security');
  assert.match(md, /audience: user/);
});

test('renderDomainMarkdown for test-coverage shows untested', () => {
  const store = makeStore('/tmp/x');
  const md = renderDomainMarkdown(store, 'test-coverage');
  assert.match(md, /Untested files/);
});

test('renderDomainMarkdown for performance', () => {
  const store = makeStore('/tmp/x');
  const md = renderDomainMarkdown(store, 'performance');
  assert.match(md, /# performance/);
});

test('renderDomainMarkdown for dependencies', () => {
  const store = makeStore('/tmp/x');
  const md = renderDomainMarkdown(store, 'dependencies');
  assert.match(md, /# dependencies/);
});

test('renderDomainMarkdown for recent-changes', () => {
  const store = makeStore('/tmp/x');
  const md = renderDomainMarkdown(store, 'recent-changes');
  assert.match(md, /# recent-changes/);
});

test('writeDocFile creates nested directories', () => {
  const cwd = makeTmp();
  try {
    const path = writeDocFile(cwd, 'docs/modules/auth.md', '# auth');
    assert.ok(existsSync(path));
    assert.equal(readFileSync(path, 'utf8'), '# auth');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runWikiBatch generates dashboard + 6 sub-docs', async () => {
  const cwd = makeTmp();
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevVoyage = process.env.VOYAGE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  try {
    makeFixture(cwd);
    const result = await runWikiBatch({ cwd, tokenBudget: 4000 });
    assert.ok(result.dashboard.path);
    assert.equal(result.subDocs.length, 6);
    for (const d of result.subDocs) assert.ok(existsSync(d.path));
  } finally {
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevVoyage === undefined) delete process.env.VOYAGE_API_KEY;
    else process.env.VOYAGE_API_KEY = prevVoyage;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('renderModuleMarkdown escapes forward slashes in path', () => {
  const store = makeStore('/tmp/x');
  const md = renderModuleMarkdown(store, 'src/auth/middleware.ts');
  assert.match(md, /src\/auth\/middleware\.ts/);
});

test('renderDomainMarkdown frontmatter includes token_cost', () => {
  const store = makeStore('/tmp/x');
  const md = renderDomainMarkdown(store, 'architecture');
  assert.match(md, /token_cost:/);
});
