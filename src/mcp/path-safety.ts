import { resolve, sep, isAbsolute } from 'path';

export class PathSafetyError extends Error {
  readonly code = 'PATH_SAFETY_VIOLATION';
  constructor(message: string, public readonly attempted: string, public readonly base: string) {
    super(message);
    this.name = 'PathSafetyError';
  }
}

const RELATIVE_OK = new Set(['', '.']);

export function safeResolvePath(base: string, requested: string | undefined | null, opts: { allowEmpty?: boolean } = {}): string {
  if (requested == null || requested === '') {
    if (opts.allowEmpty) return resolve(base);
    throw new PathSafetyError('Empty path not allowed', '', base);
  }
  if (typeof requested !== 'string') {
    throw new PathSafetyError('Path must be a string', String(requested), base);
  }
  if (requested.includes('\0')) {
    throw new PathSafetyError('NUL byte in path', requested, base);
  }
  if (requested.length > 4096) {
    throw new PathSafetyError('Path exceeds maximum length', requested.slice(0, 64) + '…', base);
  }
  const baseResolved = resolve(base);
  let resolved: string;
  try {
    resolved = isAbsolute(requested) ? resolve(requested) : resolve(baseResolved, requested);
  } catch (err) {
    throw new PathSafetyError(`Path resolution failed: ${String(err)}`, requested, base);
  }
  const baseWithSep = baseResolved.endsWith(sep) ? baseResolved : baseResolved + sep;
  if (resolved !== baseResolved && !resolved.startsWith(baseWithSep)) {
    throw new PathSafetyError(
      `Path escapes base directory: ${resolved} not under ${baseResolved}`,
      requested,
      base,
    );
  }
  if (RELATIVE_OK.has(requested) && resolved === baseResolved) {
    return resolved;
  }
  return resolved;
}

export function assertWithinBase(resolved: string, base: string): void {
  const baseResolved = resolve(base);
  const baseWithSep = baseResolved.endsWith(sep) ? baseResolved : baseResolved + sep;
  if (resolved !== baseResolved && !resolved.startsWith(baseWithSep)) {
    throw new PathSafetyError(
      `Path escapes base directory: ${resolved} not under ${baseResolved}`,
      resolved,
      base,
    );
  }
}

export function safeFileUrlPath(base: string, requested: string): string {
  return safeResolvePath(base, requested).replace(/\\/g, '/');
}

export function isSecretPath(filePath: string): boolean {
  const basename = filePath.split(/[\\/]/).pop() ?? '';
  const SECRET_BASENAMES = new Set([
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
    '.env.test',
    '.env.example',
    '.env.sample',
    'id_rsa',
    'id_rsa.pub',
    'id_ed25519',
    'id_ed25519.pub',
    '.npmrc',
    '.netrc',
    '.pypirc',
    'credentials',
    'credentials.json',
    'service-account.json',
  ]);
  if (SECRET_BASENAMES.has(basename)) return true;
  if (/\.(pem|key|p12|pfx|crt|cer)$/i.test(basename)) return true;
  return false;
}