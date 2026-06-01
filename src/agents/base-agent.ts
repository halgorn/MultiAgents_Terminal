import { spawn } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { TaskState } from '../core/state-machine.js';

const AGENT_TIMEOUT_MS = 5 * 60 * 1000;

export interface AgentConfig {
  name: string;
  model: 'claude-haiku-4-5';
  systemPrompt: string; // written as .claude/CLAUDE.md in the worktree
}

export interface AgentRun<T> {
  agentName: string;
  resolvedState: TaskState;
  output: T;
  rawText: string;
  durationMs: number;
}

export abstract class BaseAgent<TInput, TOutput> {
  constructor(protected readonly config: AgentConfig) {}

  protected abstract buildUserMessage(input: TInput): string;
  protected abstract parseOutput(text: string): TOutput;
  protected abstract resolveState(output: TOutput): TaskState;
  protected abstract getWorktreePath(input: TInput): string;

  async run(
    input: TInput,
    onChunk?: (agentName: string, text: string) => void,
  ): Promise<AgentRun<TOutput>> {
    const start = Date.now();
    const worktreePath = this.getWorktreePath(input);

    this.writeClaudeMd(worktreePath);

    const userMessage = this.buildUserMessage(input);

    const rawText = await this.runClaude(worktreePath, userMessage, onChunk);
    const output = this.parseOutput(rawText);

    return {
      agentName: this.config.name,
      resolvedState: this.resolveState(output),
      output,
      rawText,
      durationMs: Date.now() - start,
    };
  }

  private writeClaudeMd(worktreePath: string): void {
    const claudeDir = join(worktreePath, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'CLAUDE.md'), this.config.systemPrompt, 'utf8');
  }

  private runClaude(
    cwd: string,
    userMessage: string,
    onChunk?: (agentName: string, text: string) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-p', userMessage,
        '--output-format', 'stream-json',
        '--verbose',
        '--model', this.config.model,
        '--dangerously-skip-permissions',
      ];

      const proc = spawn('claude', args, {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';
      let finalResult = '';
      let accumulatedText = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          proc.kill('SIGTERM');
          reject(new Error(`[${this.config.name}] timed out after ${AGENT_TIMEOUT_MS / 1000}s`));
        }
      }, AGENT_TIMEOUT_MS);

      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;

            // Stream assistant text as it arrives
            if (event['type'] === 'assistant') {
              const msg = event['message'] as { content?: Array<{ type: string; text?: string }> };
              for (const block of msg?.content ?? []) {
                if (block.type === 'text' && block.text) {
                  accumulatedText += block.text;
                  onChunk?.(this.config.name, block.text);
                }
              }
            }

            // Final result event contains the clean text response
            if (event['type'] === 'result' && typeof event['result'] === 'string') {
              finalResult = event['result'];
            }
          } catch {
            // skip malformed lines
          }
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        // claude writes progress/status to stderr — not errors
        const text = chunk.toString();
        onChunk?.(this.config.name, text);
      });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const text = finalResult || accumulatedText;
        if (!text && code !== 0) {
          reject(new Error(`[${this.config.name}] claude exited with code ${code}`));
        } else {
          resolve(text);
        }
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`[${this.config.name}] failed to spawn claude: ${err.message}. Is 'claude' installed and in PATH?`));
      });
    });
  }

  protected parseJson<T>(text: string, label: string): T {
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    // Walk chars tracking string/escape state so braces inside string values are ignored
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1)) as T;
          } catch (err) {
            throw new Error(`${label}: failed to parse JSON — ${String(err)}\n\nRaw output:\n${text}`);
          }
        }
      }
    }
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new Error(`${label}: failed to parse JSON — ${String(err)}\n\nRaw output:\n${text}`);
    }
  }
}
