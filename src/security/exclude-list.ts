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
  'service-account-key.json',
  'gha-creds.json',
  'htpasswd',
  'shadow',
]);

const SECRET_EXTENSIONS = /\.(pem|key|p12|pfx|crt|cer|keystore|jks|asc)$/i;

const SECRET_DIR_NAMES = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.gcloud',
  '.kube',
  '.docker',
  'secrets',
  'credentials',
]);

export interface ExcludeResult {
  excluded: boolean;
  reason?: 'secret_basename' | 'secret_extension' | 'secret_dir' | 'explicit_pattern';
}

export function shouldExcludePath(filePath: string, explicitPatterns: readonly string[] = []): ExcludeResult {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return { excluded: false };

  for (const seg of segments.slice(0, -1)) {
    if (SECRET_DIR_NAMES.has(seg)) {
      return { excluded: true, reason: 'secret_dir' };
    }
  }

  const basename = segments[segments.length - 1];
  if (SECRET_BASENAMES.has(basename)) {
    return { excluded: true, reason: 'secret_basename' };
  }
  if (SECRET_EXTENSIONS.test(basename)) {
    return { excluded: true, reason: 'secret_extension' };
  }

  for (const pattern of explicitPatterns) {
    if (matchPattern(normalized, pattern)) {
      return { excluded: true, reason: 'explicit_pattern' };
    }
  }

  return { excluded: false };
}

export function isExcluded(filePath: string, explicitPatterns: readonly string[] = []): boolean {
  return shouldExcludePath(filePath, explicitPatterns).excluded;
}

function matchPattern(path: string, pattern: string): boolean {
  const p = pattern.trim();
  if (!p) return false;
  if (p.startsWith('/')) {
    return path === p.slice(1) || path.startsWith(p.slice(1) + '/');
  }
  if (p.includes('*')) {
    const re = new RegExp(
      '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$',
    );
    return re.test(path) || re.test(path.split('/').pop() ?? '');
  }
  return path === p || path.endsWith('/' + p) || path.split('/').includes(p);
}

export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
  '**/.env',
  '**/.env.*',
  '**/secrets/**',
  '**/.ssh/**',
];