import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

export const WORKSPACE_ROOT = resolve('.');
export const SOURCE_CLI = resolve('src/index.ts');

export function makeFixtureRepo(prefix = 'aion-fixture-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'rag.ts'), [
    'export function retrieveContext(query: string) {',
    '  return `semantic retrieval for ${query}`;',
    '}',
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'app.ts'), [
    "import { retrieveContext } from './rag.js';",
    'export function answerQuestion(question: string) {',
    '  return retrieveContext(question);',
    '}',
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'app.test.ts'), [
    "import { answerQuestion } from './app.js';",
    'answerQuestion("hello");',
  ].join('\n'));
  return dir;
}

export function isolatedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AION_SKIP_UPDATE_CHECK: '1',
    VOYAGE_API_KEY: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    OPENROUTER_API_KEY: '',
    QDRANT_URL: '',
    npm_config_cache: join(tmpdir(), 'aion-npm-cache'),
    ...extra,
  };
}

export function runSourceCli(repo: string, args: string[], timeout = 30_000) {
  return spawnSync(process.execPath, ['--import', 'tsx', SOURCE_CLI, '--cwd', repo, ...args], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(),
    timeout,
  });
}

/**
 * Temporarily sets environment variables for the duration of a callback,
 * restoring the previous values (or deleting them) when done.
 * Supports both sync and async callbacks; env is restored even on throw.
 */
export function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> | T {
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
