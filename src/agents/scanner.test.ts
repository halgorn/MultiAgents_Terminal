import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScannerAgent } from './scanner.js';
import type { ScannerInput } from './scanner.js';
import type { ProviderName } from '../core/runtime-policy.js';

class TestScannerAgent extends ScannerAgent {
  exposeMessage(input: ScannerInput): string {
    return (this as unknown as { buildUserMessage(i: ScannerInput): string }).buildUserMessage(input);
  }
  exposeParseOutput(text: string) {
    return (this as unknown as { parseOutput(t: string): unknown }).parseOutput(text);
  }
  exposeResolveState() {
    return (this as unknown as { resolveState(): string }).resolveState();
  }
}

function make(provider: ProviderName): TestScannerAgent {
  return new TestScannerAgent('security', 1, 1, undefined, provider);
}

function makeInput(overrides: Partial<ScannerInput> = {}): ScannerInput {
  return { domain: 'security', worktreePath: '/tmp', scannerIndex: 1, totalScanners: 1, ...overrides };
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'scanner-test-'));
}

// ── CLI provider path ──────────────────────────────────────────────────────────

test('ScannerAgent: CLI provider (claude) returns short instruction without file content', () => {
  const agent = make('claude');
  const msg = agent.exposeMessage(makeInput());
  assert.ok(msg.includes('security'), `message should reference domain, got: ${msg}`);
  assert.ok(!msg.includes('```'), 'CLI provider should not embed file content as code blocks');
});

test('ScannerAgent: CLI provider (codex) returns instruction to output JSON', () => {
  const agent = make('codex');
  const msg = agent.exposeMessage(makeInput());
  assert.ok(msg.toLowerCase().includes('json'), 'CLI message should mention JSON output');
});

// ── HTTP provider path ─────────────────────────────────────────────────────────

test('ScannerAgent: HTTP provider embeds file snippets as markdown code blocks', () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, 'app.ts'), 'const x = 1;\n');
    const agent = make('openai' as ProviderName);
    const msg = agent.exposeMessage(makeInput({
      worktreePath: dir,
      context: { targetFiles: ['app.ts'] },
    }));
    assert.ok(msg.includes('### app.ts'), 'should include filename header');
    assert.ok(msg.includes('```'), 'should include code fence');
    assert.ok(msg.includes('const x = 1'), 'should embed file content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ScannerAgent: HTTP provider limits embedded files to 20', () => {
  const dir = makeTmpDir();
  try {
    const files = Array.from({ length: 25 }, (_, i) => `file${i}.ts`);
    for (const f of files) writeFileSync(join(dir, f), `// ${f}\n`);
    const agent = make('openai' as ProviderName);
    const msg = agent.exposeMessage(makeInput({
      worktreePath: dir,
      context: { targetFiles: files },
    }));
    // Count ### headers — should be at most 20
    const headers = (msg.match(/^### /gm) ?? []).length;
    assert.ok(headers <= 20, `expected ≤20 file headers, got ${headers}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ScannerAgent: HTTP provider handles missing file gracefully', () => {
  const agent = make('openai' as ProviderName);
  const msg = agent.exposeMessage(makeInput({
    worktreePath: '/nonexistent-dir',
    context: { targetFiles: ['missing.ts'] },
  }));
  // Should not throw; missing files are filtered
  assert.ok(typeof msg === 'string');
});

// ── parseOutput ────────────────────────────────────────────────────────────────

test('ScannerAgent: parseOutput accepts valid ScanReport JSON', () => {
  const agent = make('claude');
  const json = JSON.stringify({
    filesScanned: ['src/app.ts'],
    findings: [],
    summary: 'No issues found.',
  });
  const result = agent.exposeParseOutput(json) as { summary: string };
  assert.equal(result.summary, 'No issues found.');
});

test('ScannerAgent: parseOutput throws on invalid schema (missing summary)', () => {
  const agent = make('claude');
  const json = JSON.stringify({ filesScanned: [], findings: [] });
  assert.throws(
    () => agent.exposeParseOutput(json),
    /schema error/i,
  );
});

// ── resolveState ───────────────────────────────────────────────────────────────

test('ScannerAgent: resolveState always returns INVESTIGATING', () => {
  const agent = make('claude');
  assert.equal(agent.exposeResolveState(), 'INVESTIGATING');
});
