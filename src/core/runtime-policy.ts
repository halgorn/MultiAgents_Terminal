export type BudgetName = 'low' | 'normal' | 'deep';
export type ProviderName = 'claude' | 'codex';

export interface RuntimePolicy {
  budget: BudgetName;
  deep: boolean;
  maxAgents: number;
  maxFileLines: number;
  maxOutputChars: number;
  claudeModel: 'claude-haiku-4-5';
  codexModel: string;
  plannerProvider: ProviderName;
  investigatorProvider: ProviderName;
  developerProvider: ProviderName;
  reviewerProvider: ProviderName;
  claudeMaxBudgetUsd: number;
}

export interface RuntimePolicyInput {
  budget?: BudgetName;
  deep?: boolean;
  maxAgents?: number;
  maxFileLines?: number;
  maxOutputChars?: number;
  plannerProvider?: ProviderName;
  investigatorProvider?: ProviderName;
  developerProvider?: ProviderName;
  reviewerProvider?: ProviderName;
  codexModel?: string;
}

const DEFAULT_MAX_FILE_LINES = 500;

export function createRuntimePolicy(input: RuntimePolicyInput = {}): RuntimePolicy {
  const budget = input.budget ?? (input.deep ? 'deep' : 'low');
  const deep = input.deep ?? budget === 'deep';

  const defaults = budget === 'deep'
    ? { maxAgents: 7, maxOutputChars: 20000, claudeMaxBudgetUsd: 1 }
    : budget === 'normal'
      ? { maxAgents: 5, maxOutputChars: 14000, claudeMaxBudgetUsd: 0.35 }
      : { maxAgents: 3, maxOutputChars: 10000, claudeMaxBudgetUsd: 0.12 };

  return {
    budget,
    deep,
    maxAgents: input.maxAgents ?? defaults.maxAgents,
    maxFileLines: input.maxFileLines ?? DEFAULT_MAX_FILE_LINES,
    maxOutputChars: input.maxOutputChars ?? defaults.maxOutputChars,
    claudeModel: 'claude-haiku-4-5',
    codexModel: input.codexModel ?? process.env['AI_RUNTIME_CODEX_MODEL'] ?? 'gpt-5-codex',
    plannerProvider: input.plannerProvider ?? 'claude',
    investigatorProvider: input.investigatorProvider ?? 'codex',
    developerProvider: input.developerProvider ?? 'codex',
    reviewerProvider: input.reviewerProvider ?? 'claude',
    claudeMaxBudgetUsd: defaults.claudeMaxBudgetUsd,
  };
}

export function limitLines(text: string, maxLines = DEFAULT_MAX_FILE_LINES): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + `\n[truncated: ${lines.length - maxLines} lines omitted]`;
}

export function limitChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n[truncated: ${text.length - maxChars} chars omitted]`;
}
