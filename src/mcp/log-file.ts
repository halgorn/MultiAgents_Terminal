import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_BACKUPS = 3;

export interface LogFileOptions {
  path: string;
  maxBytes?: number;
  maxBackups?: number;
}

export class RotatingLog {
  private readonly path: string;
  private readonly maxBytes: number;
  private readonly maxBackups: number;

  constructor(options: LogFileOptions) {
    this.path = options.path;
    this.maxBytes = options.maxBytes ?? MAX_BYTES;
    this.maxBackups = options.maxBackups ?? MAX_BACKUPS;
  }

  write(record: Record<string, unknown>): void {
    mkdirSync(dirname(this.path), { recursive: true });
    this.rotateIfNeeded();
    appendFileSync(this.path, JSON.stringify(record) + '\n', 'utf8');
  }

  writeBatch(records: Array<Record<string, unknown>>): void {
    if (records.length === 0) return;
    mkdirSync(dirname(this.path), { recursive: true });
    this.rotateIfNeeded();
    const text = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    appendFileSync(this.path, text, 'utf8');
  }

  rotateIfNeeded(): void {
    if (!existsSync(this.path)) return;
    const stats = statSync(this.path);
    if (stats.size < this.maxBytes) return;
    for (let i = this.maxBackups - 1; i >= 1; i--) {
      const src = `${this.path}.${i}`;
      const dst = `${this.path}.${i + 1}`;
      if (existsSync(src)) {
        if (existsSync(dst)) {
          try { renameSync(dst, `${dst}.tmp`); renameSync(`${dst}.tmp`, `${dst}.${Date.now()}`); } catch { /* ignore */ }
        }
        renameSync(src, dst);
      }
    }
    const firstBackup = `${this.path}.1`;
    if (existsSync(firstBackup)) {
      try { renameSync(firstBackup, `${firstBackup}.${Date.now()}`); } catch { /* ignore */ }
    }
    renameSync(this.path, firstBackup);
  }

  readSince(isoTimestamp?: string): string[] {
    if (!existsSync(this.path)) return [];
    const content = readFileSync(this.path, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    if (!isoTimestamp) return lines;
    const since = Date.parse(isoTimestamp);
    return lines.filter((line) => {
      try {
        const obj = JSON.parse(line) as { ts?: string };
        return obj.ts ? Date.parse(obj.ts) >= since : false;
      } catch { return false; }
    });
  }

  readLastN(n: number): string[] {
    if (!existsSync(this.path)) return [];
    const content = readFileSync(this.path, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-n);
  }

  size(): number {
    if (!existsSync(this.path)) return 0;
    return statSync(this.path).size;
  }

  clear(): void {
    if (existsSync(this.path)) writeFileSync(this.path, '', 'utf8');
  }
}

export function defaultLogPath(cwd: string): string {
  return join(cwd, '.ai-runtime', 'mcp.log');
}

export function createRotatingLog(cwd: string, customPath?: string): RotatingLog {
  return new RotatingLog({ path: customPath ?? defaultLogPath(cwd) });
}
