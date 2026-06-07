import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const IGNORE_FILE = '.aionignore';
const MAX_IGNORE_PATTERN_LENGTH = 200;
const MAX_WILDCARDS = 40;

function wildcardCount(pattern: string): number {
  return [...pattern].filter((char) => char === '*' || char === '?').length;
}

function globToRegex(pattern: string): RegExp {
  if (pattern.length > MAX_IGNORE_PATTERN_LENGTH || wildcardCount(pattern) > MAX_WILDCARDS) {
    throw new Error(`Ignoring unsafe .aionignore pattern: ${pattern.slice(0, 80)}`);
  }
  // Escape regex special chars except * and ?
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = escaped
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/__GLOBSTAR__/g, '.*');
  // If pattern has no slash, match anywhere in path
  const anchored = pattern.includes('/') ? `^${re}` : `(^|/)${re}`;
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  // The glob input is length/wildcard bounded and regex metacharacters are escaped above.
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
      .flatMap((line) => {
        try {
          return [globToRegex(line)];
        } catch {
          return [];
        }
      });
  } catch { return []; }
}

export function isIgnored(filePath: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(filePath));
}
