import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ProviderRunInput } from './types.js';
import { createRuntimePolicy } from '../core/runtime-policy.js';
import { ClaudeCliProvider, CodexCliProvider, safeProcessEnv } from './cli-provider.js';
import { OpenRouterProvider } from './openrouter-provider.js';
import { SdkProvider, setAnthropicClientFactoryForTest } from './sdk-provider.js';

function input(userMessage = 'user'): ProviderRunInput {
  return {
    agentName: 'planner',
    cwd: process.cwd(),
    systemPrompt: 'system',
    userMessage,
    policy: createRuntimePolicy({ maxOutputChars: 1_000 }),
  };
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> | T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(restore);
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

function makeBin(name: string, body: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'aion-provider-bin-'));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, 'utf8');
  chmodSync(file, 0o755);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('SdkProvider streams text and token usage from a mocked Anthropic client', async () => {
  const chunks: string[] = [];
  setAnthropicClientFactoryForTest(() => ({
    messages: {
      stream: async () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello ' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } };
        },
        finalMessage: async () => ({ usage: { input_tokens: 3, output_tokens: 2 } }),
      }),
    },
  }) as never);

  try {
    const out = await new SdkProvider().run(input(), (_agent, text) => chunks.push(text));

    assert.equal(out, 'hello world');
    assert.equal(chunks.join('').includes('tokens:3:2:0:0'), true);
  } finally {
    setAnthropicClientFactoryForTest(null);
  }
});

test('OpenRouterProvider handles streamed content, auth errors, and malformed SSE lines', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: not-json\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"prompt_tokens":4,"completion_tokens":5}}\n\n'));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  await withEnv({ OPENROUTER_API_KEY: 'sk-or-test' }, async () => {
    globalThis.fetch = async () => new Response(body, { status: 200 });
    const chunks: string[] = [];
    const out = await new OpenRouterProvider('test-model').run(input(), (_agent, text) => chunks.push(text));

    assert.equal(out, 'ok');
    assert.equal(chunks.join('').includes('tokens:4:5:0:0'), true);

    globalThis.fetch = async () => new Response('nope', { status: 401 });
    await assert.rejects(() => new OpenRouterProvider('test-model').run(input()), /OpenRouter API error 401/);
  });

  globalThis.fetch = originalFetch;
});

test('ClaudeCliProvider parses success, raw invalid JSON, and budget errors from mocked CLI', async () => {
  const fake = makeBin('claude', `
const mode = process.argv.includes('budget') ? 'budget' : process.argv.includes('invalid-json') ? 'invalid-json' : 'success';
if (mode === 'budget') {
  process.stdout.write(JSON.stringify({ is_error: true, result: 'budget exceeded' }));
} else if (mode === 'invalid-json') {
  process.stdout.write('plain text result');
} else {
  process.stdout.write(JSON.stringify({ result: 'structured result' }));
}
`);
  try {
    const path = `${fake.dir}:${process.env.PATH ?? ''}`;
    await withEnv({ PATH: path }, async () => {
      assert.equal(await new ClaudeCliProvider().run(input()), 'structured result');
    });
    await withEnv({ PATH: path }, async () => {
      assert.equal(await new ClaudeCliProvider().run(input('invalid-json')), 'plain text result');
    });
    await withEnv({ PATH: path }, async () => {
      await assert.rejects(() => new ClaudeCliProvider().run(input('budget')), /budget exceeded/);
    });
  } finally {
    fake.cleanup();
  }
});

test('CodexCliProvider reads mocked output file and cleans temporary files', async () => {
  const fake = makeBin('codex', `
const outputIndex = process.argv.indexOf('-o');
if (process.argv.some((arg) => arg.includes('fail'))) process.exit(2);
require('fs').writeFileSync(process.argv[outputIndex + 1], 'codex final answer', 'utf8');
process.stdout.write('codex progress');
`);
  try {
    const path = `${fake.dir}:${process.env.PATH ?? ''}`;
    await withEnv({ PATH: path }, async () => {
      const chunks: string[] = [];
      const out = await new CodexCliProvider().run(input(), (_agent, text) => chunks.push(text));
      assert.equal(out, 'codex final answer');
      assert.match(chunks.join(''), /usage-unavailable/);
    });
    await withEnv({ PATH: path }, async () => {
      await assert.rejects(() => new CodexCliProvider().run(input('fail')), /codex exited with code 2/);
    });
  } finally {
    fake.cleanup();
  }
});

test('safeProcessEnv strips provider and cloud credentials from child processes', () => {
  const env = withEnv({ ANTHROPIC_API_KEY: 'secret', AWS_SECRET_ACCESS_KEY: 'cloud-secret' }, () => safeProcessEnv());

  assert.equal(env['ANTHROPIC_API_KEY'], undefined);
  assert.equal(env['AWS_SECRET_ACCESS_KEY'], undefined);
});
