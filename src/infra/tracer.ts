import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { AI_RUNTIME_DIR } from './paths.js';

export interface Span {
  traceId: string;
  spanId: string;
  command: string;   // e.g. "audit", "fix", "analyze"
  agent: string;     // e.g. "scanner:security", "synthesizer"
  startMs: number;
  endMs: number;
  durationMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface Trace {
  traceId: string;
  command: string;
  startMs: number;
  endMs: number;
  totalCostUsd: number;
  totalTokens: number;
  spans: Span[];
}

export class Tracer {
  readonly traceId = randomUUID();
  private spans: Span[] = [];
  private pending = new Map<string, { spanId: string; startMs: number }>();

  constructor(private readonly command: string) {}

  startSpan(agent: string): void {
    this.pending.set(agent, { spanId: randomUUID(), startMs: Date.now() });
  }

  endSpan(
    agent: string,
    model: string,
    tokens: { input: number; output: number; cache: number },
    costUsd: number,
    error?: string,
  ): void {
    const p = this.pending.get(agent);
    if (!p) return;
    this.pending.delete(agent);
    const endMs = Date.now();
    this.spans.push({
      traceId: this.traceId,
      spanId: p.spanId,
      command: this.command,
      agent,
      startMs: p.startMs,
      endMs,
      durationMs: endMs - p.startMs,
      model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheTokens: tokens.cache,
      costUsd,
      status: error ? 'error' : 'ok',
      error,
    });
  }

  flushPending(model = 'unknown'): void {
    for (const [agent, p] of this.pending) {
      const endMs = Date.now();
      this.spans.push({
        traceId: this.traceId, spanId: p.spanId, command: this.command,
        agent, startMs: p.startMs, endMs, durationMs: endMs - p.startMs,
        model, inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0, status: 'ok',
      });
    }
    this.pending.clear();
  }

  flush(cwd: string, model?: string): void {
    this.flushPending(model);
    if (this.spans.length === 0) return;
    const dir = join(cwd, AI_RUNTIME_DIR);
    mkdirSync(dir, { recursive: true });

    const endMs = Date.now();
    const trace: Trace = {
      traceId: this.traceId,
      command: this.command,
      startMs: this.spans[0]?.startMs ?? endMs,
      endMs,
      totalCostUsd: this.spans.reduce((s, sp) => s + sp.costUsd, 0),
      totalTokens: this.spans.reduce((s, sp) => s + sp.inputTokens + sp.outputTokens, 0),
      spans: this.spans,
    };

    appendFileSync(join(dir, 'traces.jsonl'), JSON.stringify(trace) + '\n', 'utf8');
  }
}

// ── Reader ────────────────────────────────────────────────────────────────────

export function loadTraces(cwd: string, limit = 20): Trace[] {
  const path = join(cwd, AI_RUNTIME_DIR, 'traces.jsonl');
  if (!existsSync(path)) return [];

  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line) as Trace; } catch { return null; } })
    .filter((t): t is Trace => t !== null)
    .slice(-limit)
    .reverse();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}
