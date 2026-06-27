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

    const attempt = async (charOverride?: number): Promise<string> => {
      const userMessage = this.applyLimits(this.buildUserMessage(input), policy, charOverride);
      return createProvider(this.config.provider, policy).run(
        { agentName: this.config.name, cwd: worktreePath, systemPrompt: this.config.systemPrompt, userMessage, policy },
        onChunk,
      );
    };

    let rawText = await attempt();
    let output: TOutput;
    try {
      output = this.parseOutput(rawText);
    } catch {
      // Retry once with 60% context if JSON parsing failed (likely context truncation)
      rawText = await attempt(Math.floor(policy.maxOutputChars * 0.6));
      output = this.parseOutput(rawText);
    }

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

  private applyLimits(message: string, policy: RuntimePolicy, charOverride?: number): string {
    const policyBlock = `Runtime policy:
- Maximum read per file/context block: ${policy.maxFileLines} lines.
- Maximum retained CLI output: ${policy.maxOutputChars} chars.
- Budget: ${policy.budget}.

`;
    const full = policyBlock + message;
    const limitedLines = limitLines(full, policy.maxFileLines * 8);
    const charCap = charOverride ?? policy.maxOutputChars;
    const limited = limitChars(limitedLines, charCap);
    if (limited.length < full.length) {
      return limited + '\n\n[CONTEXT TRUNCATED — respond using only what is visible above; output valid JSON from partial data]';
    }
    return limited;
  }

  protected parseJson<T>(text: string, label: string, schema?: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ path: (string | number)[]; message: string }> } } }): T {
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
            const parsed = JSON.parse(cleaned.slice(start, i + 1)) as unknown;
            return this.validateAgainstSchema(parsed, schema, label, text);
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
      const parsed = JSON.parse(cleaned) as unknown;
      return this.validateAgainstSchema(parsed, schema, label, text);
    } catch (err) {
      throw new Error(`${label}: failed to parse JSON — ${String(err)}\n\nRaw output:\n${text}`);
    }
  }

  private validateAgainstSchema<T>(parsed: unknown, schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ path: (string | number)[]; message: string }> } } } | undefined, label: string, text: string): T {
    if (!schema) return parsed as T;
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issues = (result.error?.issues ?? [])
        .map((i) => `${(i.path ?? []).join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(`${label}: schema validation failed — ${issues}\n\nRaw output:\n${text}`);
    }
    return result.data as T;
  }
}
