import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkByLines, chunkMarkdown, chunkTypeScript, chunkerForPath } from './semantic.js';

test('chunkByLines: splits text by line window', () => {
  const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
  const chunks = chunkByLines(text, { maxChunkLines: 10, overlapLines: 2 });
  assert.ok(chunks.length >= 9, 'should have multiple chunks');
  for (const c of chunks) {
    assert.ok(c.endLine - c.startLine + 1 <= 10 || c.endLine === 100);
  }
});

test('chunkByLines: overlap creates shared lines', () => {
  const text = 'a\nb\nc\nd\ne';
  const chunks = chunkByLines(text, { maxChunkLines: 2, overlapLines: 1 });
  assert.ok(chunks.length >= 2);
});

test('chunkMarkdown: splits at section headers', () => {
  const md = `# Section 1
content 1

## Section 2
content 2

# Section 3
content 3`;
  const chunks = chunkMarkdown(md);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0]?.type, 'section');
  assert.match(chunks[0]?.text ?? '', /Section 1/);
  assert.match(chunks[2]?.text ?? '', /Section 3/);
});

test('chunkMarkdown: falls back to paragraph chunking for prose', () => {
  const md = 'paragraph 1 line\nparagraph 1 line 2\nparagraph 1 line 3\nparagraph 1 line 4';
  const chunks = chunkMarkdown(md, { maxChunkLines: 2, overlapLines: 0 });
  assert.ok(chunks.length > 0);
});

test('chunkTypeScript: extracts function as one chunk', () => {
  const ts = `function hello() {
  console.log("hi");
  return 42;
}

function world() {
  return "world";
}`;
  const chunks = chunkTypeScript(ts);
  assert.ok(chunks.some((c) => c.type === 'function' && c.text.includes('function hello')));
  assert.ok(chunks.some((c) => c.type === 'function' && c.text.includes('function world')));
});

test('chunkTypeScript: extracts class as one chunk', () => {
  const ts = `class Foo {
  bar() { return 1; }
  baz() { return 2; }
}`;
  const chunks = chunkTypeScript(ts);
  const classChunk = chunks.find((c) => c.type === 'class');
  assert.ok(classChunk);
  assert.match(classChunk.text, /class Foo/);
});

test('chunkTypeScript: handles nested braces correctly', () => {
  const ts = `function outer() {
  const obj = { key: { nested: "value" } };
  function inner() { return obj.key.nested; }
  return inner();
}`;
  const chunks = chunkTypeScript(ts);
  const outer = chunks.find((c) => c.text.includes('function outer'));
  assert.ok(outer);
  assert.match(outer.text, /function inner/);
});

test('chunkTypeScript: handles strings with braces', () => {
  const ts = `function f() {
  const s = "} } }";
  return s;
}`;
  const chunks = chunkTypeScript(ts);
  const f = chunks.find((c) => c.text.includes('function f'));
  assert.ok(f);
  assert.match(f.text, /"\} \} \}" |}\s*}/s);
});

test('chunkerForPath: returns TS chunker for .ts', () => {
  const c = chunkerForPath('src/foo.ts');
  assert.equal(c.constructor.name, 'TypeScriptChunker');
});

test('chunkerForPath: returns markdown chunker for .md', () => {
  const c = chunkerForPath('README.md');
  assert.equal(c.constructor.name, 'MarkdownChunker');
});

test('chunkerForPath: returns line chunker for unknown', () => {
  const c = chunkerForPath('foo.txt');
  assert.equal(c.constructor.name, 'LineChunker');
});