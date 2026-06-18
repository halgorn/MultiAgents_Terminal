import { readProjectStore } from '../infra/project-store.js';
import { DEFAULT_FRESHNESS, RAW_READ_AVG_COUNT, RAW_READ_TOKEN_ESTIMATE, type Confidence, type FreshnessConfig, type McpResponseMeta } from './types.js';

export interface FreshnessInput {
  indexedAt: string;
  filesChangedSince: number;
  filesTotal: number;
  now?: Date;
}

export function estimateTokensSaved(estTokens: number): number {
  const rawReadTotal = RAW_READ_AVG_COUNT * RAW_READ_TOKEN_ESTIMATE;
  return Math.max(0, rawReadTotal - estTokens);
}

export function computeConfidence(
  input: FreshnessInput,
  config: FreshnessConfig = DEFAULT_FRESHNESS,
  now: Date = new Date(),
): Confidence {
  const ageMs = now.getTime() - Date.parse(input.indexedAt);
  const ageSec = Math.max(0, Math.floor(ageMs / 1000));

  if (input.filesChangedSince <= config.highMaxChanged && ageSec < config.staleAgeSec / 4) {
    return 'high';
  }
  if (input.filesChangedSince < config.staleMinChanged && ageSec < config.staleAgeSec) {
    return 'medium';
  }
  return 'stale';
}

export function shouldResync(
  input: FreshnessInput,
  config: FreshnessConfig = DEFAULT_FRESHNESS,
  now: Date = new Date(),
): boolean {
  return computeConfidence(input, config, now) === 'stale';
}

export interface BuildMetaOptions {
  cwd: string;
  tool?: string;
  resource?: string;
  traceId: string;
  estTokens: number;
  config?: FreshnessConfig;
}

export function buildResponseMeta(options: BuildMetaOptions): McpResponseMeta {
  const store = readProjectStore(options.cwd);
  const indexedAt = store?.generatedAt ?? new Date(0).toISOString();
  const filesTotal = store?.stats.files ?? 0;
  const filesChangedSince = 0;
  const confidence = computeConfidence(
    { indexedAt, filesChangedSince, filesTotal },
    options.config ?? DEFAULT_FRESHNESS,
  );
  return {
    pilVersion: store?.schemaVersion ?? 1,
    indexedAt,
    filesTotal,
    filesChangedSince,
    confidence,
    syncRecommended: confidence === 'stale',
    estTokens: options.estTokens,
    tokensSaved: estimateTokensSaved(options.estTokens),
    traceId: options.traceId,
    tool: options.tool,
    resource: options.resource,
  };
}

export function buildResponseMetaWithFiles(
  options: BuildMetaOptions,
  filesChangedSince: number,
): McpResponseMeta {
  const base = buildResponseMeta(options);
  return {
    ...base,
    filesChangedSince,
    confidence: computeConfidence(
      { indexedAt: base.indexedAt, filesChangedSince, filesTotal: base.filesTotal },
      options.config ?? DEFAULT_FRESHNESS,
    ),
  };
}

void RAW_READ_TOKEN_ESTIMATE;

export function formatConfidence(c: Confidence): string {
  switch (c) {
    case 'high': return '🟢 high';
    case 'medium': return '🟡 medium';
    case 'stale': return '🔴 stale';
  }
}
