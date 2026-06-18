import { log } from '../infra/logger.js';
import { estimateTokens, type ObservabilityEntry, type McpResponseMeta } from './types.js';

const RING_BUFFER_SIZE = 100;

class RingBuffer {
  private readonly buffer: ObservabilityEntry[] = [];
  private cursor = 0;

  push(entry: ObservabilityEntry): void {
    this.buffer[this.cursor] = entry;
    this.cursor = (this.cursor + 1) % RING_BUFFER_SIZE;
  }

  recent(limit?: number): ObservabilityEntry[] {
    const n = Math.min(limit ?? RING_BUFFER_SIZE, this.buffer.length);
    const result: ObservabilityEntry[] = [];
    for (let i = 0; i < n; i++) {
      const idx = (this.cursor - n + i + RING_BUFFER_SIZE) % RING_BUFFER_SIZE;
      const entry = this.buffer[idx];
      if (entry) result.push(entry);
    }
    return result;
  }

  summary(): { total: number; errors: number; avgDurationMs: number; totalTokens: number; p50: number; p95: number } {
    const entries = this.recent();
    if (entries.length === 0) {
      return { total: 0, errors: 0, avgDurationMs: 0, totalTokens: 0, p50: 0, p95: 0 };
    }
    const errors = entries.filter((e) => e.status === 'error').length;
    const durations = entries.map((e) => e.durationMs).sort((a, b) => a - b);
    const total = entries.length;
    const totalTokens = entries.reduce((sum, e) => sum + e.estTokens, 0);
    const avgDurationMs = Math.round(durations.reduce((s, d) => s + d, 0) / total);
    const p50 = durations[Math.floor(total * 0.5)] ?? 0;
    const p95 = durations[Math.floor(total * 0.95)] ?? 0;
    return { total, errors, avgDurationMs, totalTokens, p50, p95 };
  }

  clear(): void {
    this.buffer.length = 0;
    this.cursor = 0;
  }
}

const ring = new RingBuffer();

function generateTraceId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export interface WithObservabilityOptions {
  tool?: string;
  resource?: string;
  args?: Record<string, unknown>;
}

export interface WithObservabilityResult<T> {
  result: T;
  meta: Partial<McpResponseMeta>;
}

export async function withObservability<T>(
  options: WithObservabilityOptions,
  fn: (traceId: string) => Promise<T>,
): Promise<{ result: T; entry: ObservabilityEntry; meta: Partial<McpResponseMeta> }> {
  const traceId = generateTraceId();
  const startedAt = Date.now();
  const scopedLog = log.child('mcp');
  let status: 'ok' | 'error' = 'ok';
  let error: string | undefined;
  let result: T | undefined;
  try {
    result = await fn(traceId);
    status = 'ok';
  } catch (err) {
    status = 'error';
    error = String(err);
    scopedLog.error('handler failed', { traceId, tool: options.tool, resource: options.resource, error });
    throw err;
  } finally {
    const durationMs = Date.now() - startedAt;
    const resultMeta = (result && typeof result === 'object' && 'meta' in result) ? (result as { meta?: Partial<McpResponseMeta> }).meta : undefined;
    const resultJson = result ? JSON.stringify(result).slice(0, 500) : '';
    const estTokens = estimateTokens(resultMeta?.estTokens ? String(resultMeta.estTokens) : resultJson);
    ring.push({
      traceId,
      ts: new Date().toISOString(),
      tool: options.tool,
      resource: options.resource,
      durationMs,
      status,
      estTokens,
      args: options.args,
      error,
    });
    scopedLog.info('mcp call', { traceId, tool: options.tool, resource: options.resource, durationMs, status, estTokens });
  }
  const resultMeta = (result && typeof result === 'object' && 'meta' in result) ? (result as { meta?: Partial<McpResponseMeta> }).meta : undefined;
  const resultJson = result ? JSON.stringify(result).slice(0, 500) : '';
  const estTokens = estimateTokens(resultMeta?.estTokens ? String(resultMeta.estTokens) : resultJson);
  const entry: ObservabilityEntry = {
    traceId,
    ts: new Date().toISOString(),
    tool: options.tool,
    resource: options.resource,
    durationMs: Date.now() - startedAt,
    status,
    estTokens,
    args: options.args,
    error,
  };
  return { result: result as T, entry, meta: resultMeta ?? {} };
}

export function recentEntries(limit?: number): ObservabilityEntry[] {
  return ring.recent(limit);
}

export function observabilitySummary(): ReturnType<RingBuffer['summary']> {
  return ring.summary();
}

export function clearObservability(): void {
  ring.clear();
}

export const RING_SIZE = RING_BUFFER_SIZE;
