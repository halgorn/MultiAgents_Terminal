import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import type { ProviderName, RuntimePolicy } from '../core/runtime-policy.js';
import { limitChars } from '../core/runtime-policy.js';

const AGENT_TIMEOUT_MS = 5 * 60 * 1000;

export interface ProviderRunInput {
  agentName: string;
  cwd: string;
  systemPrompt: string;
  userMessage: string;
  policy: RuntimePolicy;
}

export interface AgentProvider {
  readonly name: ProviderName;
  run(input: ProviderRunInput, onChunk?: (agentName: string, text: string) => void): Promise<string>;
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
    const proc = spawn(command, args, {
      cwd,
      env: process.env,
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
      reject(new Error(`[${agentName}] failed to spawn ${command}: ${err.message}`));
    });
  });
}

export class ClaudeCliProvider implements AgentProvider {
  readonly name = 'claude' as const;

  async run(input: ProviderRunInput, onChunk?: (agentName: string, text: string) => void): Promise<string> {
    const args = [
      '-p', input.userMessage,
      '--bare',
      '--no-session-persistence',
      '--output-format', 'json',
      '--model', input.policy.claudeModel,
      '--system-prompt', input.systemPrompt,
      '--max-budget-usd', String(input.policy.claudeMaxBudgetUsd),
    ];

    const raw = await runProcess('claude', args, input.cwd, input.agentName, input.policy.maxOutputChars, onChunk);
    try {
      const event = JSON.parse(raw) as { result?: unknown };
      if (typeof event.result === 'string') return event.result;
    } catch {
      // Fall through to raw text; parseJson will validate the final structure.
    }
    return raw;
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
      '--ignore-rules',
      '--color', 'never',
      '-o', outputFile,
      prompt,
    ];

    try {
      await runProcess('codex', args, input.cwd, input.agentName, input.policy.maxOutputChars, onChunk);
      return limitChars(readFileSync(outputFile, 'utf8'), input.policy.maxOutputChars);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

export function createProvider(name: ProviderName): AgentProvider {
  return name === 'codex' ? new CodexCliProvider() : new ClaudeCliProvider();
}
