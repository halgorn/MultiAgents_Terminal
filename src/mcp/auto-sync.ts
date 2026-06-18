import { log } from '../infra/logger.js';
import { readProjectStore } from '../infra/project-store.js';
import { runSync } from '../cli/commands/sync.js';
import { computeConfidence } from './freshness.js';
import { DEFAULT_FRESHNESS, type FreshnessConfig } from './types.js';

export interface AutoSyncResult {
  synced: boolean;
  reason: 'missing' | 'stale' | 'fresh' | 'forced';
  durationMs: number;
  confidenceBefore?: 'high' | 'medium' | 'stale';
}

export interface AutoSyncOptions {
  cwd: string;
  config?: FreshnessConfig;
  force?: boolean;
  skipEmbeddings?: boolean;
  quiet?: boolean;
}

export async function autoSyncIfNeeded(options: AutoSyncOptions): Promise<AutoSyncResult> {
  const start = Date.now();
  const scopedLog = log.child('mcp.auto-sync');
  const config = options.config ?? DEFAULT_FRESHNESS;
  const store = readProjectStore(options.cwd);

  if (options.force) {
    scopedLog.info('sync forced', { cwd: options.cwd });
    await runSync(options.cwd, { skipEmbeddings: options.skipEmbeddings, quiet: options.quiet });
    return { synced: true, reason: 'forced', durationMs: Date.now() - start };
  }

  if (!store) {
    scopedLog.info('PIL missing — running initial sync', { cwd: options.cwd });
    await runSync(options.cwd, { skipEmbeddings: options.skipEmbeddings, quiet: options.quiet });
    return { synced: true, reason: 'missing', durationMs: Date.now() - start };
  }

  const confidence = computeConfidence(
    { indexedAt: store.generatedAt, filesChangedSince: 0, filesTotal: store.stats.files },
    config,
  );

  if (confidence === 'stale') {
    scopedLog.info('PIL stale — re-syncing', { cwd: options.cwd, confidence });
    await runSync(options.cwd, { skipEmbeddings: options.skipEmbeddings, quiet: options.quiet });
    return { synced: true, reason: 'stale', durationMs: Date.now() - start, confidenceBefore: confidence };
  }

  scopedLog.debug('PIL fresh — no sync', { cwd: options.cwd, confidence });
  return { synced: false, reason: 'fresh', durationMs: Date.now() - start, confidenceBefore: confidence };
}
