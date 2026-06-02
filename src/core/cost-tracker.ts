export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AgentCost {
  agentName: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  durationMs: number;
}

// Pricing per million tokens (public rates as of 2025)
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-haiku-4-5':  { input: 0.80,  output: 4.00,  cacheRead: 0.08,  cacheWrite: 1.00 },
  'claude-sonnet-4-6': { input: 3.00,  output: 15.00, cacheRead: 0.30,  cacheWrite: 3.75 },
  'claude-opus-4-8':   { input: 15.00, output: 75.00, cacheRead: 1.50,  cacheWrite: 18.75 },
};

function calcCost(model: string, usage: TokenUsage): number {
  const rates = PRICING[model] ?? PRICING['claude-haiku-4-5']!;
  const M = 1_000_000;
  return (
    (usage.inputTokens * rates.input) / M +
    (usage.outputTokens * rates.output) / M +
    (usage.cacheReadTokens * rates.cacheRead) / M +
    (usage.cacheWriteTokens * rates.cacheWrite) / M
  );
}

export class CostTracker {
  private entries: AgentCost[] = [];

  record(agentName: string, model: string, usage: TokenUsage, durationMs: number): void {
    this.entries.push({
      agentName,
      model,
      usage,
      costUsd: calcCost(model, usage),
      durationMs,
    });
  }

  totalUsd(): number {
    return this.entries.reduce((s, e) => s + e.costUsd, 0);
  }

  totalTokens(): TokenUsage {
    return this.entries.reduce(
      (acc, e) => ({
        inputTokens: acc.inputTokens + e.usage.inputTokens,
        outputTokens: acc.outputTokens + e.usage.outputTokens,
        cacheReadTokens: acc.cacheReadTokens + e.usage.cacheReadTokens,
        cacheWriteTokens: acc.cacheWriteTokens + e.usage.cacheWriteTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );
  }

  assertUnderBudget(capUsd: number): void {
    const total = this.totalUsd();
    if (total > capUsd) {
      throw new Error(`Budget exceeded: $${total.toFixed(4)} > cap $${capUsd}`);
    }
  }

  summary(): string {
    const total = this.totalTokens();
    const usd = this.totalUsd();
    const saved = total.cacheReadTokens > 0
      ? `  cache saved: ~$${((total.cacheReadTokens * 0.72) / 1_000_000).toFixed(4)}`
      : '';
    return [
      `cost: $${usd.toFixed(4)}`,
      `tokens: ${total.inputTokens}in ${total.outputTokens}out`,
      `cache: ${total.cacheReadTokens}read ${total.cacheWriteTokens}write`,
      saved,
    ].filter(Boolean).join(' | ');
  }

  byAgent(): AgentCost[] {
    return [...this.entries].sort((a, b) => b.costUsd - a.costUsd);
  }
}
