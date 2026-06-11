import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { AI_RUNTIME_DIR } from '../infra/paths.js';

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
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00,  cacheRead: 0.08,  cacheWrite: 1.00 },
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00, cacheRead: 0.30,  cacheWrite: 3.75 },
  'claude-opus-4-8':           { input: 15.00, output: 75.00, cacheRead: 1.50,  cacheWrite: 18.75 },
};

function calcCost(model: string, usage: TokenUsage): number {
  const rates = PRICING[model] ?? PRICING['claude-haiku-4-5-20251001']!;
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
  private unavailableAgents = new Set<string>();

  record(agentName: string, model: string, usage: TokenUsage, durationMs: number): void {
    this.unavailableAgents.delete(agentName);
    this.entries.push({
      agentName,
      model,
      usage,
      costUsd: calcCost(model, usage),
      durationMs,
    });
  }

  recordUnavailable(agentName: string): void {
    if (!this.entries.some((entry) => entry.agentName === agentName)) {
      this.unavailableAgents.add(agentName);
    }
  }

  usageAvailable(): boolean {
    return this.entries.length > 0 && this.unavailableAgents.size === 0;
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
      this.usageAvailable() ? `cost: $${usd.toFixed(4)}` : 'cost: unavailable',
      `tokens: ${total.inputTokens}in ${total.outputTokens}out`,
      `cache: ${total.cacheReadTokens}read ${total.cacheWriteTokens}write`,
      this.unavailableAgents.size > 0 ? `usage unavailable: ${[...this.unavailableAgents].sort().join(', ')}` : '',
      saved,
    ].filter(Boolean).join(' | ');
  }

  byAgent(): AgentCost[] {
    return [...this.entries].sort((a, b) => b.costUsd - a.costUsd);
  }
}

// ── Session Budget ────────────────────────────────────────────────────────────

const SESSION_BUDGET_FILE = join(AI_RUNTIME_DIR, 'session-budget.json');
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const AVG_SCANNER_COST_USD: Record<string, number> = {
  'claude-haiku-4-5-20251001': 0.08,
  'claude-sonnet-4-6': 0.30,
  'claude-opus-4-8': 1.20,
};

interface SessionBudgetData {
  capUsd: number;
  spentUsd: number;
  updatedAt: string;
}

export class SessionBudget {
  private data: SessionBudgetData;
  private readonly filePath: string;

  constructor(cwd: string, capUsd = 1.50) {
    this.filePath = join(cwd, SESSION_BUDGET_FILE);
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as SessionBudgetData;
      const age = Date.now() - new Date(parsed.updatedAt).getTime();
      this.data = age < SESSION_TTL_MS
        ? { ...parsed, capUsd: Math.max(parsed.capUsd, capUsd) }
        : { capUsd, spentUsd: 0, updatedAt: new Date().toISOString() };
    } catch {
      this.data = { capUsd, spentUsd: 0, updatedAt: new Date().toISOString() };
    }
  }

  remaining(): number {
    return Math.max(0, this.data.capUsd - this.data.spentUsd);
  }

  estimatedCost(nScanners: number, model: string): number {
    const perScanner = AVG_SCANNER_COST_USD[model] ?? 0.10;
    return nScanners * perScanner * 1.3;
  }

  canAfford(estimatedUsd: number): boolean {
    return this.remaining() >= estimatedUsd;
  }

  warningLine(): string | null {
    const pct = this.data.capUsd > 0 ? this.remaining() / this.data.capUsd : 1;
    if (pct < 0.30) return `⚠ Session budget low: $${this.remaining().toFixed(2)} of $${this.data.capUsd.toFixed(2)} remaining`;
    return null;
  }

  record(spentUsd: number): void {
    this.data.spentUsd += spentUsd;
    this.data.updatedAt = new Date().toISOString();
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch { /* best-effort */ }
  }
}
