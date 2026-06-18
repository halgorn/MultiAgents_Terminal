import { watch, type FSWatcher, existsSync, statSync } from 'fs';
import { join, relative } from 'path';
import { log } from '../infra/logger.js';
import { isIgnoredDirName } from '../infra/file-filter.js';

export interface WatcherOptions {
  cwd: string;
  roots?: string[];
  onChange?: (file: string) => void;
  onError?: (err: Error) => void;
  debounceMs?: number;
}

export interface WatcherStats {
  filesChangedSinceStart: number;
  watchedRoots: string[];
  startedAt: string;
  active: boolean;
}

export class FileWatcher {
  private readonly cwd: string;
  private readonly roots: string[];
  private readonly onChange?: (file: string) => void;
  private readonly onError?: (err: Error) => void;
  private readonly debounceMs: number;
  private watchers: FSWatcher[] = [];
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private filesChangedSinceStart = 0;
  private startedAt = '';
  private active = false;

  constructor(options: WatcherOptions) {
    this.cwd = options.cwd;
    this.roots = options.roots ?? ['src', 'lib'];
    this.onChange = options.onChange;
    this.onError = options.onError;
    this.debounceMs = options.debounceMs ?? 200;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.startedAt = new Date().toISOString();
    const scopedLog = log.child('mcp.watcher');

    for (const root of this.roots) {
      const fullPath = join(this.cwd, root);
      if (!existsSync(fullPath)) {
        scopedLog.debug('root does not exist, skipping', { root });
        continue;
      }
      try {
        const stats = statSync(fullPath);
        if (!stats.isDirectory()) {
          scopedLog.debug('root is not a directory, skipping', { root });
          continue;
        }
        const w = watch(fullPath, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          const rel = relative(this.cwd, join(fullPath, filename.toString()));
          if (isIgnoredDirName(filename.toString().split('/')[0] ?? '')) return;
          this.debounceAndFire(rel);
        });
        w.on('error', (err) => {
          scopedLog.error('watcher error', { root, error: String(err) });
          this.onError?.(err);
        });
        this.watchers.push(w);
        scopedLog.info('watching', { root });
      } catch (err) {
        scopedLog.error('failed to start watcher', { root, error: String(err) });
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  stop(): void {
    for (const w of this.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    for (const t of this.debounceTimers.values()) {
      clearTimeout(t);
    }
    this.debounceTimers.clear();
    this.watchers = [];
    this.active = false;
  }

  stats(): WatcherStats {
    return {
      filesChangedSinceStart: this.filesChangedSinceStart,
      watchedRoots: [...this.roots],
      startedAt: this.startedAt,
      active: this.active,
    };
  }

  filesChanged(): number {
    return this.filesChangedSinceStart;
  }

  private debounceAndFire(file: string): void {
    const existing = this.debounceTimers.get(file);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(file, setTimeout(() => {
      this.debounceTimers.delete(file);
      this.filesChangedSinceStart++;
      log.child('mcp.watcher').info('file changed', { file, total: this.filesChangedSinceStart });
      this.onChange?.(file);
    }, this.debounceMs));
  }
}

export function createWatcher(options: WatcherOptions): FileWatcher {
  return new FileWatcher(options);
}
