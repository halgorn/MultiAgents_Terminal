import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { TaskState } from '../core/state-machine.js';
import type { ProviderName, RuntimePolicy } from '../core/runtime-policy.js';
import { createRuntimePolicy, limitChars, limitLines } from '../core/runtime-policy.js';
import { createProvider } from '../providers/cli-provider.js';

export interface AgentConfig {
  name: string;
  provider: ProviderName;
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
    policy: RuntimePolicy = createRuntimePolicy(),
    onChunk?: (agentName: string, text: string) => void,
  ): Promise<AgentRun<TOutput>> {
    const start = Date.now();
    const worktreePath = this.getWorktreePath(input);

    this.writeClaudeMd(worktreePath);

    const userMessage = this.applyLimits(this.buildUserMessage(input), policy);

    const rawText = await createProvider(this.config.provider).run(
      {
        agentName: this.config.name,
        cwd: worktreePath,
        systemPrompt: this.config.systemPrompt,
        userMessage,
        policy,
      },
      onChunk,
    );
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

  private applyLimits(message: string, policy: RuntimePolicy): string {
    const policyBlock = `Runtime policy:
- Maximum read per file/context block: ${policy.maxFileLines} lines.
- Maximum retained CLI output: ${policy.maxOutputChars} chars.
- Budget: ${policy.budget}.

`;
    const limitedLines = limitLines(policyBlock + message, policy.maxFileLines * 8);
    return limitChars(limitedLines, policy.maxOutputChars);
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
    if (/not logged in|please run.*login|run \/login/i.test(text)) {
      throw new Error(`Claude CLI is not authenticated. Run: claude /login`);
    }
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new Error(`${label}: failed to parse JSON — ${String(err)}\n\nRaw output:\n${text}`);
    }
  }
}
