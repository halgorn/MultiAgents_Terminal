import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const PACKAGE_NAME = '@aionlabsai/aion';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface UpdateCache {
  checkedAt: number;
  latestVersion: string;
  currentVersion: string;
}

function cacheFile(): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/tmp';
  return join(home, '.aion', 'update-check.json');
}

function readCache(): UpdateCache | null {
  try {
    const f = cacheFile();
    if (!existsSync(f)) return null;
    return JSON.parse(readFileSync(f, 'utf8')) as UpdateCache;
  } catch { return null; }
}

function writeCache(cache: UpdateCache): void {
  try {
    const f = cacheFile();
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, JSON.stringify(cache), 'utf8');
  } catch { /* ignore */ }
}

export function getCurrentVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
  } catch { return '0.0.0'; }
}

async function fetchLatest(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { version?: string }).version ?? null;
  } catch { return null; }
}

function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}

export async function checkForUpdate(): Promise<void> {
  const current = getCurrentVersion();
  const cache = readCache();
  const now = Date.now();

  if (cache && isNewer(cache.latestVersion, current)) {
    const { default: chalk } = await import('chalk');
    console.log(
      '\n' +
      chalk.yellow.bold(`  ┌─ Update available: ${current} → ${cache.latestVersion}`) +
      '\n' +
      chalk.gray(`  │  npm install -g ${PACKAGE_NAME}@latest`) +
      '\n' +
      chalk.yellow('  └─────────────────────────────────────────') +
      '\n'
    );
  }

  if (!cache || now - cache.checkedAt > CHECK_INTERVAL_MS) {
    fetchLatest()
      .then((latest) => { if (latest) writeCache({ checkedAt: now, latestVersion: latest, currentVersion: current }); })
      .catch(() => {});
  }
}
