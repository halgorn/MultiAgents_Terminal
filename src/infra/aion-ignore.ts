import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const IGNORE_FILE = '.aionignore';

function globToRegex(pattern: string): RegExp {
  // Escape regex special chars except * and ?
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = escaped
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/__GLOBSTAR__/g, '.*');
  // If pattern has no slash, match anywhere in path
  const anchored = pattern.includes('/') ? `^${re}` : `(^|/)${re}`;
  return new RegExp(`${anchored}($|/)`);
}

export function loadIgnorePatterns(cwd: string): RegExp[] {
  const path = join(cwd, IGNORE_FILE);
  if (!existsSync(path)) return [];
  try {
    const content = readFileSync(path, 'utf8');
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map(globToRegex);
  } catch { return []; }
}

export function isIgnored(filePath: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(filePath));
}
