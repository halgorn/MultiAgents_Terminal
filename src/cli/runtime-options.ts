import type { Command } from 'commander';
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
  if (value === 'low' || value === 'normal' || value === 'deep') return value;
  throw new Error('--budget must be one of: low, normal, deep');
}

function parseProvider(value: string | undefined, label: string): ProviderName | undefined {
  if (!value) return undefined;
  if (value === 'claude' || value === 'codex') return value;
  throw new Error(`${label} must be one of: claude, codex`);
}

export function toRuntimePolicyInput(options: RuntimeCliOptions): RuntimePolicyInput {
  return {
    budget: parseBudget(options.budget),
    deep: options.deep,
    maxAgents: parsePositiveInt(options.maxAgents, '--max-agents'),
    maxFileLines: parsePositiveInt(options.maxLines, '--max-lines'),
    maxOutputChars: parsePositiveInt(options.maxOutputChars, '--max-output-chars'),
    plannerProvider: parseProvider(options.plannerProvider, '--planner-provider'),
    investigatorProvider: parseProvider(options.investigatorProvider, '--investigator-provider'),
    developerProvider: parseProvider(options.developerProvider, '--developer-provider'),
    reviewerProvider: parseProvider(options.reviewerProvider, '--reviewer-provider'),
    codexModel: options.codexModel,
  };
}

export function addRuntimeOptions(command: Command): Command {
  return command
    .option('--budget <budget>', 'runtime budget: low, normal, deep', 'low')
    .option('--deep', 'run deeper multi-agent fan-out')
    .option('--max-agents <n>', 'maximum agents to fan out')
    .option('--max-lines <n>', 'maximum lines per file/context block', '500')
    .option('--max-output-chars <n>', 'maximum output chars kept per CLI call')
    .option('--planner-provider <provider>', 'planner provider: claude or codex')
    .option('--investigator-provider <provider>', 'investigator provider: claude or codex')
    .option('--developer-provider <provider>', 'developer provider: claude or codex')
    .option('--reviewer-provider <provider>', 'reviewer provider: claude or codex')
    .option('--codex-model <model>', 'model passed to codex exec');
}
