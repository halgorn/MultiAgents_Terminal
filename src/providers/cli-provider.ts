import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn, spawnSync } from 'child_process';
import type { ProviderName, RuntimePolicy } from '../core/runtime-policy.js';
import { limitChars } from '../core/runtime-policy.js';
import { SdkProvider } from './sdk-provider.js';
import { OpenRouterProvider } from './openrouter-provider.js';
export type { ProviderRunInput, AgentProvider } from './types.js';

const AGENT_TIMEOUT_MS = 5 * 60 * 1000;
const USAGE_UNAVAILABLE = '\0usage-unavailable\0';
const STRUCTURED_RESULT_MAX_CHARS = 200_000;

// Minimal tool sets per agent role — principle of least privilege
export const AGENT_TOOLS: Record<string, string[]> = {
  planner:              ['Read', 'Glob', 'Grep'],
  'investigator-backend':   ['Read', 'Glob', 'Grep', 'Bash'],
  'investigator-frontend':  ['Read', 'Glob', 'Grep', 'Bash'],
  'investigator-bug-history': ['Read', 'Glob', 'Grep', 'Bash'],
  developer:            ['Read', 'Edit', 'Write', 'Bash'],
  reviewer:             ['Read', 'Glob', 'Grep'],
  qa:                   ['Bash', 'Read'],
};

const DEFAULT_TOOLS = ['Read', 'Glob', 'Grep'];

// ProviderRunInput and AgentProvider are defined in ./types.ts
import type { ProviderRunInput, AgentProvider } from './types.js';

export function safeProcessEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const allowed = [
    'PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP',
    'LANG', 'LC_ALL', 'TERM', 'COLORTERM',
    'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
    'OPENROUTER_BASE_URL', 'AI_RUNTIME_CODEX_MODEL',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  agentName: string,
  maxOutputChars: number,
  onChunk?: (agentName: string, text: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    // command is selected by provider code (claude/codex) and args are passed without a shell.
    const proc = spawn(command, args, {
      cwd,
      env: safeProcessEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      reject(new Error(`[${agentName}] ${command} timed out after ${AGENT_TIMEOUT_MS / 1000}s`));
    }, AGENT_TIMEOUT_MS);

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onChunk?.(agentName, text);
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      onChunk?.(agentName, text);
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`[${agentName}] ${command} exited with code ${code}: ${limitChars(stderr, maxOutputChars)}`));
        return;
      }
      resolve(limitChars(stdout, maxOutputChars));
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const isNotFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
      const msg = isNotFound
        ? `${command} not found. Install Claude CLI (https://claude.ai/download) or set ANTHROPIC_API_KEY`
        : `[${agentName}] failed to spawn ${command}: ${err.message}`;
      reject(new Error(msg));
    });
  });
}

export class ClaudeCliProvider implements AgentProvider {
  readonly name = 'claude' as const;

  async run(input: ProviderRunInput, onChunk?: (agentName: string, text: string) => void): Promise<string> {
    const allowedTools = AGENT_TOOLS[input.agentName] ?? DEFAULT_TOOLS;
    const args = [
      '-p', input.userMessage,
      '--output-format', 'json',
      '--model', input.policy.claudeModel,
      '--max-budget-usd', String(input.policy.claudeMaxBudgetUsd),
      '--allowedTools', allowedTools.join(','),
    ];

    // Use a large cap for raw so the outer JSON envelope isn't truncated
    const raw = await runProcess('claude', args, input.cwd, input.agentName, 200_000, onChunk);
    onChunk?.(input.agentName, USAGE_UNAVAILABLE);
    try {
      const event = JSON.parse(raw) as { result?: string; is_error?: boolean };
      if (event.is_error) {
        const msg = event.result ?? 'unknown';
        if (typeof msg === 'string' && msg.includes('budget')) {
          throw new Error(`[${input.agentName}] budget exceeded ($${input.policy.claudeMaxBudgetUsd}). Use --budget normal or --budget deep for larger tasks.`);
        }
        throw new Error(`[${input.agentName}] claude error: ${msg}`);
      }
      // Truncate only the result content, not the JSON envelope
      if (typeof event.result === 'string') {
        return limitChars(event.result, Math.max(input.policy.maxOutputChars, STRUCTURED_RESULT_MAX_CHARS));
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith(`[${input.agentName}]`)) throw err;
    }
    return limitChars(raw, input.policy.maxOutputChars);
  }
}

export class CodexCliProvider implements AgentProvider {
  readonly name = 'codex' as const;

  async run(input: ProviderRunInput, onChunk?: (agentName: string, text: string) => void): Promise<string> {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-runtime-codex-'));
    const outputFile = join(tempDir, 'last-message.txt');
    const prompt = `${input.systemPrompt}\n\n${input.userMessage}`;
    const args = [
      'exec',
      '-C', input.cwd,
      '-m', input.policy.codexModel,
      '-s', 'workspace-write',
      '-a', 'never',
      '--ephemeral',
      '--color', 'never',
      '-o', outputFile,
      prompt,
    ];
    if (process.env['AION_CODEX_IGNORE_RULES'] === '1') {
      args.splice(args.indexOf('--color'), 0, '--ignore-rules');
    }

    try {
      await runProcess('codex', args, input.cwd, input.agentName, input.policy.maxOutputChars, onChunk);
      onChunk?.(input.agentName, USAGE_UNAVAILABLE);
      return limitChars(readFileSync(outputFile, 'utf8'), input.policy.maxOutputChars);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

export function createProvider(name: ProviderName, policy?: { openrouterModel?: string }): AgentProvider {
  if (name === 'codex') return new CodexCliProvider();
  if (name === 'openrouter') {
    const model = policy?.openrouterModel ?? process.env['OPENROUTER_MODEL'] ?? 'moonshotai/kimi-k2';
    return new OpenRouterProvider(model);
  }
  // SDK provider when key is set: enables prompt caching + real streaming
  // Falls back to CLI provider when no key (uses claude CLI session auth)
  if (process.env['ANTHROPIC_API_KEY']) return new SdkProvider();
  if (process.env['OPENROUTER_API_KEY']) return new OpenRouterProvider(process.env['OPENROUTER_MODEL'] ?? 'moonshotai/kimi-k2');
  const which = spawnSync('which', ['claude'], { encoding: 'utf8' });
  if (which.status !== 0) {
    throw new Error(
      'No AI provider configured.\n' +
      '  • Set ANTHROPIC_API_KEY=sk-ant-...\n' +
      '  • or OPENROUTER_API_KEY=sk-or-...\n' +
      '  • or install Claude CLI: https://claude.ai/download'
    );
  }
  return new ClaudeCliProvider();
}
