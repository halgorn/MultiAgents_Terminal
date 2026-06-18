import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ScopedLogger,
  type LogLevel,
  type LogFields,
  createLogger,
  rankOf,
  isValidLevel,
  defaultLevel,
  defaultFormat,
} from './logger.js';

function captureStdout(fn: () => void): string {
  const chunks: Buffer[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Buffer) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  }) as typeof process.stdout.write;
  try { fn(); } finally { process.stdout.write = orig; }
  return Buffer.concat(chunks).toString('utf8');
}

function captureStderr(fn: () => void): string {
  const chunks: Buffer[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Buffer) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  }) as typeof process.stderr.write;
  try { fn(); } finally { process.stderr.write = orig; }
  return Buffer.concat(chunks).toString('utf8');
}

test('rankOf returns numeric ordering', () => {
  assert.ok(rankOf('debug') < rankOf('info'));
  assert.ok(rankOf('info') < rankOf('warn'));
  assert.ok(rankOf('warn') < rankOf('error'));
  assert.ok(rankOf('error') < rankOf('silent'));
});

test('isValidLevel recognizes known levels', () => {
  assert.equal(isValidLevel('debug'), true);
  assert.equal(isValidLevel('info'), true);
  assert.equal(isValidLevel('warn'), true);
  assert.equal(isValidLevel('error'), true);
  assert.equal(isValidLevel('silent'), true);
  assert.equal(isValidLevel('bogus'), false);
  assert.equal(isValidLevel(''), false);
});

test('defaultLevel returns info when env unset or invalid', () => {
  const prev = process.env.AION_LOG_LEVEL;
  delete process.env.AION_LOG_LEVEL;
  assert.equal(defaultLevel(), 'info');
  process.env.AION_LOG_LEVEL = 'bogus';
  assert.equal(defaultLevel(), 'info');
  process.env.AION_LOG_LEVEL = 'warn';
  assert.equal(defaultLevel(), 'warn');
  if (prev === undefined) delete process.env.AION_LOG_LEVEL;
  else process.env.AION_LOG_LEVEL = prev;
});

test('defaultFormat returns pretty by default and json when set', () => {
  const prev = process.env.AION_LOG_FORMAT;
  delete process.env.AION_LOG_FORMAT;
  assert.equal(defaultFormat(), 'pretty');
  process.env.AION_LOG_FORMAT = 'json';
  assert.equal(defaultFormat(), 'json');
  process.env.AION_LOG_FORMAT = 'JSON';
  assert.equal(defaultFormat(), 'json');
  if (prev === undefined) delete process.env.AION_LOG_FORMAT;
  else process.env.AION_LOG_FORMAT = prev;
});

test('createLogger with level=info suppresses debug', () => {
  const log = createLogger({ level: 'info', format: 'pretty' });
  const out = captureStdout(() => { log.debug('hidden'); log.info('visible'); });
  assert.doesNotMatch(out, /hidden/);
  assert.match(out, /visible/);
});

test('createLogger with level=silent suppresses everything', () => {
  const log = createLogger({ level: 'silent', format: 'pretty' });
  const out = captureStdout(() => { log.info('a'); log.error('b'); });
  assert.equal(out, '');
});

test('createLogger routes error to stderr only', () => {
  const log = createLogger({ level: 'debug', format: 'pretty' });
  const err = captureStderr(() => log.error('boom', { code: 42 }));
  assert.match(err, /boom/);
  assert.match(err, /code=42/);
});

test('createLogger with format=json emits valid JSON', () => {
  const log = createLogger({ level: 'debug', format: 'json' });
  const out = captureStdout(() => log.info('json-msg', { k: 'v' }));
  const obj = JSON.parse(out.trim());
  assert.equal(obj.msg, 'json-msg');
  assert.equal(obj.k, 'v');
  assert.equal(obj.level, 'info');
  assert.ok(obj.ts);
});

test('createLogger with format=json routes error to stderr', () => {
  const log = createLogger({ level: 'debug', format: 'json' });
  const err = captureStderr(() => log.error('err-msg'));
  const obj = JSON.parse(err.trim());
  assert.equal(obj.level, 'error');
  assert.equal(obj.msg, 'err-msg');
});

test('scoped logger attaches scope to every call', () => {
  const log = createLogger({ level: 'debug', format: 'json' });
  const out = captureStdout(() => {
    const sl = log.child('sync');
    sl.info('msg');
  });
  const obj = JSON.parse(out.trim());
  assert.equal(obj.scope, 'sync');
});

test('fields are stringified cleanly', () => {
  const log = createLogger({ level: 'debug', format: 'pretty' });
  const out = captureStdout(() => log.info('m', { a: 1, b: 'x', c: true, d: { nested: 1 } }));
  assert.match(out, /a=1/);
  assert.match(out, /b=x/);
  assert.match(out, /c=true/);
  assert.match(out, /d=/);
});

test('all log levels typecheck', () => {
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
  assert.equal(levels.length, 5);
});

test('fields can be undefined safely', () => {
  const log = createLogger({ level: 'debug', format: 'pretty' });
  const out = captureStdout(() => log.info('m'));
  assert.match(out, /m/);
  assert.doesNotMatch(out, /undefined/);
});

test('circular reference in fields does not crash', () => {
  const log = createLogger({ level: 'debug', format: 'pretty' });
  const circular: LogFields = { name: 'c' };
  circular.self = circular;
  assert.doesNotThrow(() => captureStdout(() => log.info('msg', circular)));
});
