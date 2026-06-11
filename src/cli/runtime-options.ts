import type { Command } from 'commander';
import { BUDGET_NAMES, PROVIDER_NAMES, DEFAULT_MODELS } from '../core/runtime-policy.js';
import type { BudgetName, ProviderName, RuntimePolicyInput } from '../core/runtime-policy.js';

export interface RuntimeCliOptions {
  budget?: BudgetName;
  deep?: boolean;
  maxAgents?: string;
  maxLines?: string;
  maxOutputChars?: string;
  plannerProvider?: ProviderName;
  investigatorProvider?: ProviderName;
  developerProvider?: ProviderName;
  reviewerProvider?: ProviderName;
  codexModel?: string;
  openrouterModel?: string;
  kimiModel?: string;
  minimaxModel?: string;
  provider?: string;
}

function parsePositiveInt(value: string | undefined, label: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseBudget(value: string | undefined): BudgetName | undefined {
  if (!value) return undefined;
  if ((BUDGET_NAMES as readonly string[]).includes(value)) return value as BudgetName;
  throw new Error(`--budget must be one of: ${BUDGET_NAMES.join(', ')}`);
}

function parseProvider(value: string | undefined, label: string): ProviderName | undefined {
  if (!value) return undefined;
  if ((PROVIDER_NAMES as readonly string[]).includes(value)) return value as ProviderName;
  throw new Error(`${label} must be one of: ${PROVIDER_NAMES.join(', ')}`);
}

export function toRuntimePolicyInput(options: RuntimeCliOptions): RuntimePolicyInput {
  const globalProvider = options.provider ? parseProvider(options.provider, '--provider') : undefined;
  return {
    budget: parseBudget(options.budget),
    deep: options.deep,
    maxAgents: parsePositiveInt(options.maxAgents, '--max-agents'),
    maxFileLines: parsePositiveInt(options.maxLines, '--max-lines'),
    maxOutputChars: parsePositiveInt(options.maxOutputChars, '--max-output-chars'),
    plannerProvider: parseProvider(options.plannerProvider, '--planner-provider') ?? globalProvider,
    investigatorProvider: parseProvider(options.investigatorProvider, '--investigator-provider') ?? globalProvider,
    developerProvider: parseProvider(options.developerProvider, '--developer-provider') ?? globalProvider,
    reviewerProvider: parseProvider(options.reviewerProvider, '--reviewer-provider') ?? globalProvider,
    codexModel: options.codexModel,
    openrouterModel: options.openrouterModel,
    kimiModel: options.kimiModel,
    minimaxModel: options.minimaxModel,
  };
}

export function addRuntimeOptions(command: Command): Command {
  return command
    .option('--budget <budget>', 'runtime budget: low, normal, deep', 'low')
    .option('--deep', 'run deeper multi-agent fan-out')
    .option('--provider <provider>', 'global provider: claude, codex, openrouter, kimi, minimax')
    .option('--model <model>', 'model override for openrouter (e.g. moonshotai/kimi-k2)')
    .option('--max-agents <n>', 'maximum agents to fan out')
    .option('--max-lines <n>', 'maximum lines per file/context block', '500')
    .option('--max-output-chars <n>', 'maximum output chars kept per CLI call')
    .option('--planner-provider <provider>', 'planner provider: claude, codex, openrouter, kimi, minimax')
    .option('--investigator-provider <provider>', 'investigator provider: claude, codex, openrouter, kimi, minimax')
    .option('--developer-provider <provider>', 'developer provider: claude, codex, openrouter, kimi, minimax')
    .option('--reviewer-provider <provider>', 'reviewer provider: claude, codex, openrouter, kimi, minimax')
    .option('--codex-model <model>', 'model passed to codex exec')
    .option('--openrouter-model <model>', 'model passed to openrouter')
    .option('--kimi-model <model>', `model passed to Kimi API (default: ${DEFAULT_MODELS.kimi})`)
    .option('--minimax-model <model>', `model passed to MiniMax API (default: ${DEFAULT_MODELS.minimax})`);
}
