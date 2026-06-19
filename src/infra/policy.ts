import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { AION_CONFIG_FILE } from './paths.js';

export interface BudgetCap {
  monthlyUsd: number;
  perRequestUsd: number;
  warnAtPct: number;
}

export interface DenyListRule {
  pattern: string;
  reason: string;
  audience: 'user' | 'assistant' | 'both';
}

export interface Policy {
  budget: BudgetCap;
  denyList: DenyListRule[];
  defaultModel?: string;
  fallbackModel?: string;
  updatedAt: string;
}

export const DEFAULT_POLICY: Policy = {
  budget: {
    monthlyUsd: 50,
    perRequestUsd: 1,
    warnAtPct: 80,
  },
  denyList: [
    { pattern: '**/.env*', reason: 'environment secrets', audience: 'both' },
    { pattern: '.env*', reason: 'environment secrets', audience: 'both' },
    { pattern: '**/secrets/**', reason: 'secrets directory', audience: 'both' },
    { pattern: '**/credentials/**', reason: 'credentials directory', audience: 'both' },
    { pattern: '**/*.pem', reason: 'private keys', audience: 'both' },
    { pattern: '**/*.key', reason: 'private keys', audience: 'both' },
  ],
  defaultModel: 'claude',
  fallbackModel: 'claude-haiku',
  updatedAt: new Date(0).toISOString(),
};

export function policyPath(cwd: string): string {
  return join(cwd, AION_CONFIG_FILE);
}

export function readPolicy(cwd: string): Policy {
  const path = policyPath(cwd);
  if (!existsSync(path)) return { ...DEFAULT_POLICY, updatedAt: new Date().toISOString() };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { policy?: Partial<Policy> };
    if (!raw.policy) return { ...DEFAULT_POLICY, updatedAt: new Date().toISOString() };
    return mergeWithDefaults(raw.policy);
  } catch {
    return { ...DEFAULT_POLICY, updatedAt: new Date().toISOString() };
  }
}

export function writePolicy(cwd: string, policy: Policy): string {
  const path = policyPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  let raw: Record<string, unknown> = {};
  if (existsSync(path)) {
    try { raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { raw = {}; }
  }
  raw['policy'] = policy;
  writeFileSync(path, JSON.stringify(raw, null, 2), 'utf8');
  return path;
}

export function mergeWithDefaults(partial: Partial<Policy>): Policy {
  return {
    budget: { ...DEFAULT_POLICY.budget, ...(partial.budget ?? {}) },
    denyList: partial.denyList ?? DEFAULT_POLICY.denyList,
    defaultModel: partial.defaultModel ?? DEFAULT_POLICY.defaultModel,
    fallbackModel: partial.fallbackModel ?? DEFAULT_POLICY.fallbackModel,
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
  };
}

export function matchesDenyList(path: string, rules: DenyListRule[]): DenyListRule | null {
  for (const rule of rules) {
    if (matchGlob(rule.pattern, path)) return rule;
  }
  return null;
}

function matchGlob(pattern: string, path: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(path);
}

function globToRegex(pattern: string): RegExp {
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*';
        i++;
      } else {
        regex += '[^/]*';
      }
    } else if (c === '?') {
      regex += '[^/]';
    } else if (c === '.') {
      regex += '\\.';
    } else if ('+^$()[]{}|\\'.includes(c ?? '')) {
      regex += '\\' + c;
    } else {
      regex += c;
    }
  }
  regex += '$';
  return new RegExp(regex);
}

export interface UsageRecord {
  ts: string;
  tool?: string;
  resource?: string;
  estTokens: number;
  estimatedCostUsd: number;
  model: string;
  traceId: string;
}

export interface UsageSummary {
  month: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
  budgetUsd: number;
  budgetUsedPct: number;
  overBudget: boolean;
  nearBudget: boolean;
}

const USAGE_FILE = 'usage.jsonl';

export function usagePath(cwd: string): string {
  return join(cwd, '.ai-runtime', USAGE_FILE);
}

export function recordUsage(cwd: string, record: UsageRecord): void {
  const path = usagePath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const line = JSON.stringify(record) + '\n';
  appendFileSync(path, line, 'utf8');
}

export function readUsageThisMonth(cwd: string): UsageRecord[] {
  const path = usagePath(cwd);
  if (!existsSync(path)) return [];
  try {
    const content = readFileSync(path, 'utf8');
    const month = new Date().toISOString().slice(0, 7);
    return content.split('\n').filter(Boolean).flatMap((line) => {
      try {
        const rec = JSON.parse(line) as UsageRecord;
        return rec.ts.startsWith(month) ? [rec] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

export function summarizeUsage(cwd: string, policy: Policy): UsageSummary {
  const records = readUsageThisMonth(cwd);
  const month = new Date().toISOString().slice(0, 7);
  const totalTokens = records.reduce((s, r) => s + r.estTokens, 0);
  const totalCostUsd = records.reduce((s, r) => s + r.estimatedCostUsd, 0);
  const budgetUsedPct = policy.budget.monthlyUsd > 0
    ? Math.round((totalCostUsd / policy.budget.monthlyUsd) * 100)
    : 0;
  return {
    month,
    totalTokens,
    totalCostUsd,
    requestCount: records.length,
    budgetUsd: policy.budget.monthlyUsd,
    budgetUsedPct,
    overBudget: totalCostUsd > policy.budget.monthlyUsd,
    nearBudget: budgetUsedPct >= policy.budget.warnAtPct && !this_overBudget(policy, totalCostUsd),
  };
}

function this_overBudget(policy: Policy, cost: number): boolean {
  return cost > policy.budget.monthlyUsd;
}

export const COST_PER_1K_TOKENS: Record<string, number> = {
  claude: 0.015,
  'claude-haiku': 0.0008,
  'claude-sonnet': 0.003,
  'gpt-4': 0.03,
  'gpt-4o-mini': 0.00015,
  default: 0.002,
};

export function estimateCost(model: string, estTokens: number): number {
  const rate = COST_PER_1K_TOKENS[model] ?? COST_PER_1K_TOKENS['default']!;
  return (estTokens / 1000) * rate;
}
