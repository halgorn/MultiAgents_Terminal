export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type LogFormat = 'pretty' | 'json';

export interface LogFields {
  [key: string]: unknown;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const KNOWN_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error', 'silent']);

export function rankOf(level: LogLevel): number {
  return LEVEL_RANK[level];
}

export function isValidLevel(value: string): value is LogLevel {
  return KNOWN_LEVELS.has(value as LogLevel);
}

export function defaultLevel(): LogLevel {
  const raw = (process.env.AION_LOG_LEVEL ?? 'info').toLowerCase();
  return isValidLevel(raw) ? raw : 'info';
}

export function defaultFormat(): LogFormat {
  return (process.env.AION_LOG_FORMAT ?? 'pretty').toLowerCase() === 'json' ? 'json' : 'pretty';
}

export interface LoggerConfig {
  level?: LogLevel;
  format?: LogFormat;
  scope?: string;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(scope: string): Logger;
}

function stringifyVal(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function mergeFields(scope: string | undefined, fields?: LogFields): LogFields {
  if (!scope) return fields ?? {};
  return { scope, ...(fields ?? {}) };
}

export function createLogger(config: LoggerConfig = {}): Logger {
  const level: LogLevel = config.level ?? defaultLevel();
  const format: LogFormat = config.format ?? defaultFormat();
  const activeRank = LEVEL_RANK[level];
  const scope = config.scope;

  function emit(msgLevel: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_RANK[msgLevel] < activeRank) return;

    const merged = mergeFields(scope, fields);

    if (format === 'json') {
      const record = { ts: new Date().toISOString(), level: msgLevel, msg, ...merged };
      const stream = msgLevel === 'error' ? process.stderr : process.stdout;
      try {
        stream.write(JSON.stringify(record) + '\n');
      } catch {
        stream.write(JSON.stringify({ ts: record.ts, level: record.level, msg }) + '\n');
      }
      return;
    }

    const tail = Object.keys(merged).length > 0
      ? ' ' + Object.entries(merged).map(([k, v]) => `${k}=${stringifyVal(v)}`).join(' ')
      : '';
    const line = `[${msgLevel.toUpperCase()}] ${msg}${tail}\n`;
    if (msgLevel === 'error') process.stderr.write(line);
    else process.stdout.write(line);
  }

  return {
    debug(msg, fields) { emit('debug', msg, fields); },
    info(msg, fields) { emit('info', msg, fields); },
    warn(msg, fields) { emit('warn', msg, fields); },
    error(msg, fields) { emit('error', msg, fields); },
    child(childScope) {
      return createLogger({
        level,
        format,
        scope: scope ? `${scope}.${childScope}` : childScope,
      });
    },
  };
}

export const log: Logger = createLogger();

export class ScopedLogger {
  private readonly inner: Logger;
  private readonly scope: string;
  constructor(scope: string) {
    this.scope = scope;
    this.inner = createLogger({ scope });
  }
  debug(msg: string, fields?: LogFields): void { this.inner.debug(msg, fields); }
  info(msg: string, fields?: LogFields): void { this.inner.info(msg, fields); }
  warn(msg: string, fields?: LogFields): void { this.inner.warn(msg, fields); }
  error(msg: string, fields?: LogFields): void { this.inner.error(msg, fields); }
  child(childScope: string): ScopedLogger {
    return new ScopedLogger(`${this.scope}.${childScope}`);
  }
}
