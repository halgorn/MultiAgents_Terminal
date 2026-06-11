export type BudgetName = 'low' | 'normal' | 'deep';
export const BUDGET_NAMES = ['low', 'normal', 'deep'] as const;
export type ProviderName = 'claude' | 'codex' | 'openrouter' | 'kimi' | 'minimax';
export const PROVIDER_NAMES = ['claude', 'codex', 'openrouter', 'kimi', 'minimax'] as const;
export type ClaudeModel = 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6' | 'claude-opus-4-8';

export const DEFAULT_MODELS = {
  codex: 'gpt-5-codex',
  openrouter: 'moonshotai/kimi-k2',
  kimi: 'kimi-m3',
  minimax: 'MiniMax-Text-01',
} as const;

export interface RuntimePolicy {
  budget: BudgetName;
  deep: boolean;
  maxAgents: number;
  maxFileLines: number;
  maxOutputChars: number;
  claudeModel: ClaudeModel;
  codexModel: string;
  openrouterModel: string;
  kimiModel: string;
  minimaxModel: string;
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
  openrouterModel?: string;
  kimiModel?: string;
  minimaxModel?: string;
}

const DEFAULT_MAX_FILE_LINES = 500;

export function createRuntimePolicy(input: RuntimePolicyInput = {}): RuntimePolicy {
  const budget = input.budget ?? (input.deep ? 'deep' : 'low');
  const deep = input.deep ?? budget === 'deep';

  const defaults = budget === 'deep'
    ? { maxAgents: 7, maxOutputChars: 20000, claudeMaxBudgetUsd: 5.0, claudeModel: 'claude-opus-4-8' as ClaudeModel }
    : budget === 'normal'
      ? { maxAgents: 2, maxOutputChars: 14000, claudeMaxBudgetUsd: 2.0, claudeModel: 'claude-sonnet-4-6' as ClaudeModel }
      : { maxAgents: 1, maxOutputChars: 10000, claudeMaxBudgetUsd: 1.0, claudeModel: 'claude-haiku-4-5-20251001' as ClaudeModel };

  return {
    budget,
    deep,
    maxAgents: input.maxAgents ?? defaults.maxAgents,
    maxFileLines: input.maxFileLines ?? DEFAULT_MAX_FILE_LINES,
    maxOutputChars: input.maxOutputChars ?? defaults.maxOutputChars,
    claudeModel: defaults.claudeModel,
    codexModel: input.codexModel ?? process.env['AI_RUNTIME_CODEX_MODEL'] ?? DEFAULT_MODELS.codex,
    openrouterModel: input.openrouterModel ?? process.env['OPENROUTER_MODEL'] ?? DEFAULT_MODELS.openrouter,
    kimiModel: input.kimiModel ?? process.env['KIMI_MODEL'] ?? DEFAULT_MODELS.kimi,
    minimaxModel: input.minimaxModel ?? process.env['MINIMAX_MODEL'] ?? DEFAULT_MODELS.minimax,
    plannerProvider: input.plannerProvider ?? 'claude',
    investigatorProvider: input.investigatorProvider ?? 'claude',
    developerProvider: input.developerProvider ?? 'claude',
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
