import type { Command } from 'commander';
import chalk from 'chalk';
import {
  readPolicy,
  writePolicy,
  summarizeUsage,
  recordUsage,
  estimateCost,
  matchesDenyList,
  DEFAULT_POLICY,
  type Policy,
  type BudgetCap,
} from '../../infra/policy.js';

export function renderPolicy(policy: Policy, summary: ReturnType<typeof summarizeUsage> | null = null): string {
  const lines: string[] = [];
  lines.push(`# Policy\n`);
  lines.push(`Updated: ${policy.updatedAt}\n`);
  lines.push(`## Budget`);
  lines.push(`- Monthly: $${policy.budget.monthlyUsd}`);
  lines.push(`- Per request: $${policy.budget.perRequestUsd}`);
  lines.push(`- Warn at: ${policy.budget.warnAtPct}%`);
  lines.push(`\n## Models`);
  lines.push(`- Default: \`${policy.defaultModel}\``);
  lines.push(`- Fallback: \`${policy.fallbackModel}\``);
  lines.push(`\n## Deny list (${policy.denyList.length} rules)`);
  for (const rule of policy.denyList) {
    lines.push(`- \`${rule.pattern}\` — ${rule.reason} (audience: ${rule.audience})`);
  }
  if (summary) {
    lines.push(`\n## Usage this month (${summary.month})`);
    lines.push(`- Requests: ${summary.requestCount}`);
    lines.push(`- Tokens: ${summary.totalTokens.toLocaleString()}`);
    lines.push(`- Cost: $${summary.totalCostUsd.toFixed(4)}`);
    lines.push(`- Budget: $${summary.budgetUsd} (${summary.budgetUsedPct}%)`);
    if (summary.overBudget) lines.push(`- ⚠ OVER BUDGET`);
    else if (summary.nearBudget) lines.push(`- ⚠ Near budget (≥${policy.budget.warnAtPct}%)`);
  }
  return lines.join('\n');
}

export function setBudget(cwd: string, budget: Partial<BudgetCap>): Policy {
  const current = readPolicy(cwd);
  const updated: Policy = {
    ...current,
    budget: { ...current.budget, ...budget, updatedAt: undefined as never } as BudgetCap,
    updatedAt: new Date().toISOString(),
  };
  updated.budget = { ...current.budget, ...budget };
  writePolicy(cwd, updated);
  return updated;
}

export function addDenyRule(cwd: string, pattern: string, reason: string): Policy {
  const current = readPolicy(cwd);
  const updated: Policy = {
    ...current,
    denyList: [...current.denyList, { pattern, reason, audience: 'both' }],
    updatedAt: new Date().toISOString(),
  };
  writePolicy(cwd, updated);
  return updated;
}

export function removeDenyRule(cwd: string, pattern: string): Policy {
  const current = readPolicy(cwd);
  const updated: Policy = {
    ...current,
    denyList: current.denyList.filter((r) => r.pattern !== pattern),
    updatedAt: new Date().toISOString(),
  };
  writePolicy(cwd, updated);
  return updated;
}

export function checkDenyList(cwd: string, path: string): { allowed: boolean; reason?: string } {
  const policy = readPolicy(cwd);
  const match = matchesDenyList(path, policy.denyList);
  if (match) return { allowed: false, reason: match.reason };
  return { allowed: true };
}

export function recordToolUsage(
  cwd: string,
  options: { tool: string; estTokens: number; model?: string; traceId: string },
): { cost: number; overBudget: boolean } {
  const model = options.model ?? 'default';
  const cost = estimateCost(model, options.estTokens);
  recordUsage(cwd, {
    ts: new Date().toISOString(),
    tool: options.tool,
    estTokens: options.estTokens,
    estimatedCostUsd: cost,
    model,
    traceId: options.traceId,
  });
  const policy = readPolicy(cwd);
  const summary = summarizeUsage(cwd, policy);
  return { cost, overBudget: summary.overBudget };
}

export function registerPolicy(program: Command): void {
  const policy = program
    .command('policy')
    .description('Manage aion policy: budget, deny list, model selection');

  policy
    .command('show')
    .description('Show current policy and usage summary')
    .action(() => {
      const cwd = process.cwd();
      const p = readPolicy(cwd);
      const summary = summarizeUsage(cwd, p);
      console.log(renderPolicy(p, summary));
    });

  policy
    .command('set-budget <monthly>')
    .description('Set monthly budget cap in USD')
    .option('--per-request <usd>', 'per-request cap', '1')
    .option('--warn-at <pct>', 'warn at percentage of budget', '80')
    .action((monthly: string, opts: { perRequest?: string; warnAt?: string }) => {
      const cwd = process.cwd();
      const updated = setBudget(cwd, {
        monthlyUsd: parseFloat(monthly),
        perRequestUsd: parseFloat(opts.perRequest ?? '1'),
        warnAtPct: parseInt(opts.warnAt ?? '80', 10),
      });
      console.log(chalk.green(`  ✓ budget set: $${updated.budget.monthlyUsd}/month`));
    });

  policy
    .command('add-deny <pattern>')
    .description('Add a pattern to the deny list')
    .option('--reason <text>', 'why this path is denied', 'sensitive path')
    .action((pattern: string, opts: { reason?: string }) => {
      const cwd = process.cwd();
      const updated = addDenyRule(cwd, pattern, opts.reason ?? 'sensitive path');
      console.log(chalk.green(`  ✓ denied \`${pattern}\``));
      void updated;
    });

  policy
    .command('remove-deny <pattern>')
    .description('Remove a pattern from the deny list')
    .action((pattern: string) => {
      const cwd = process.cwd();
      removeDenyRule(cwd, pattern);
      console.log(chalk.green(`  ✓ removed \`${pattern}\``));
    });

  policy
    .command('reset')
    .description('Reset policy to defaults')
    .action(() => {
      const cwd = process.cwd();
      const fresh: Policy = { ...DEFAULT_POLICY, updatedAt: new Date().toISOString() };
      writePolicy(cwd, fresh);
      console.log(chalk.green('  ✓ policy reset to defaults'));
    });

  policy
    .command('check <path>')
    .description('Check if a path is allowed by the deny list')
    .action((path: string) => {
      const cwd = process.cwd();
      const result = checkDenyList(cwd, path);
      if (result.allowed) {
        console.log(chalk.green(`  ✓ allowed: ${path}`));
      } else {
        console.log(chalk.red(`  ✗ denied: ${path} (${result.reason})`));
      }
    });
}
