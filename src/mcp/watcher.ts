import { watch, type FSWatcher, existsSync, statSync } from 'fs';
import { join, relative } from 'path';
import { log } from '../infra/logger.js';
import { isIgnoredDirName } from '../infra/file-filter.js';

export interface WatcherOptions {
  cwd: string;
  roots?: string[];
  files?: string[];
  watchRootFiles?: boolean;
  watchAll?: boolean;
  onChange?: (file: string) => void;
  onError?: (err: Error) => void;
  debounceMs?: number;
}

export interface WatcherStats {
  filesChangedSinceStart: number;
  watchedRoots: string[];
  watchedFiles: string[];
  startedAt: string;
  active: boolean;
}

const DEFAULT_ROOT_FILES = [
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.build.json',
  '.aionrc.json',
  '.aionignore',
];

export class FileWatcher {
  private readonly cwd: string;
  private readonly roots: string[];
  private readonly files: string[];
  private readonly onChange?: (file: string) => void;
  private readonly onError?: (err: Error) => void;
  private readonly debounceMs: number;
  private watchers: FSWatcher[] = [];
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private filesChangedSinceStart = 0;
  private startedAt = '';
  private active = false;
  private watchAll: boolean;

  constructor(options: WatcherOptions) {
    this.cwd = options.cwd;
    this.watchAll = options.watchAll ?? false;
    this.roots = options.roots ?? (this.watchAll ? ['src', 'lib', 'app', 'packages', 'services'] : ['src', 'lib']);
    const files: string[] = [...(options.files ?? [])];
    if (options.watchRootFiles !== false && !this.watchAll) {
      for (const f of DEFAULT_ROOT_FILES) {
        if (existsSync(join(this.cwd, f)) && !files.includes(f)) files.push(f);
      }
    }
    this.files = files;
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
          const firstSegment = filename.toString().split('/')[0] ?? '';
          if (!this.watchAll && isIgnoredDirName(firstSegment)) return;
          this.debounceAndFire(rel);
        });
        w.on('error', (err) => {
          scopedLog.error('watcher error', { root, error: String(err) });
          this.onError?.(err);
        });
        this.watchers.push(w);
        scopedLog.info('watching directory', { root });
      } catch (err) {
        scopedLog.error('failed to start watcher', { root, error: String(err) });
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }

    for (const file of this.files) {
      const fullPath = join(this.cwd, file);
      if (!existsSync(fullPath)) {
        scopedLog.debug('file does not exist, skipping', { file });
        continue;
      }
      try {
        const stats = statSync(fullPath);
        if (!stats.isFile()) continue;
        const w = watch(fullPath, (eventType) => {
          this.debounceAndFire(file);
        });
        w.on('error', (err) => {
          scopedLog.error('watcher error', { file, error: String(err) });
          this.onError?.(err);
        });
        this.watchers.push(w);
        scopedLog.info('watching file', { file });
      } catch (err) {
        scopedLog.debug('failed to watch file', { file, error: String(err) });
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
      watchedFiles: [...this.files],
      startedAt: this.startedAt,
      active: this.active,
    };
  }

  filesChanged(): number {
    return this.filesChangedSinceStart;
  }

  addRoot(root: string): void {
    if (!this.roots.includes(root)) this.roots.push(root);
  }

  addFile(file: string): void {
    if (!this.files.includes(file)) this.files.push(file);
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

export { DEFAULT_ROOT_FILES };
