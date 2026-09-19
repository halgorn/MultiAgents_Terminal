import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

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

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

async function fetchLatest(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const version = ((await res.json()) as { version?: string }).version;
    // Registry response is untrusted input; installUpdate() interpolates this into a
    // shell:true spawn, so reject anything that isn't a plain semver before it gets there.
    return version && SEMVER_RE.test(version) ? version : null;
  } catch { return null; }
}

export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}

export function shouldRefreshUpdateCache(cache: UpdateCache | null, current: string, now = Date.now()): boolean {
  if (!cache) return true;
  if (cache.currentVersion !== current) return true;
  if (isNewer(current, cache.latestVersion)) return true;
  return now - cache.checkedAt > CHECK_INTERVAL_MS;
}

// ── Non-TTY fallback: print warning, do not block ────────────────────────────

function warnUpdate(current: string, latest: string): void {
  process.stderr.write(
    '\n' +
    chalk.yellow.bold(`  ┌─ Nova versão disponível: ${current} → ${latest}`) + '\n' +
    chalk.white(`  │  Execute: npm install -g ${PACKAGE_NAME}@latest`) + '\n' +
    chalk.yellow('  └' + '─'.repeat(50)) + '\n\n',
  );
}

// ── Interactive TTY menu ─────────────────────────────────────────────────────

const MENU_LINES = 8;

function renderMenu(current: string, latest: string, selected: number): void {
  const items = [
    chalk.cyan.bold(`Atualizar agora`) + chalk.dim(`  (npm install -g ${PACKAGE_NAME}@latest)`),
    chalk.white('Continuar sem atualizar'),
  ];

  const lines = [
    '',
    chalk.yellow.bold(`  ┌─ Nova versão disponível: ${chalk.white(current)} → ${chalk.green.bold(latest)}`),
    chalk.yellow('  │'),
    chalk.yellow('  │  ') + chalk.dim('Use ↑↓ para navegar, Enter para confirmar:'),
    chalk.yellow('  │'),
    ...items.map((label, i) =>
      chalk.yellow('  │  ') + (selected === i ? chalk.green('❯ ') + label : chalk.dim('  ') + label),
    ),
    chalk.yellow('  └' + '─'.repeat(52)),
    '',
  ];

  process.stdout.write(lines.join('\n'));
}

async function interactiveUpdateMenu(current: string, latest: string): Promise<'update' | 'continue'> {
  return new Promise((resolve) => {
    let selected = 0;

    // Initial render
    renderMenu(current, latest, selected);

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    // Hide cursor during menu
    process.stdout.write('\x1B[?25l');

    function teardown() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onKey);
      process.stdout.write('\x1B[?25h'); // restore cursor
    }

    function redraw() {
      // Move cursor up MENU_LINES lines and redraw
      process.stdout.write(`\x1B[${MENU_LINES}A`);
      renderMenu(current, latest, selected);
    }

    function onKey(key: string) {
      if (key === '\x03') { // Ctrl+C
        teardown();
        process.stdout.write('\n');
        process.exit(0);
      }

      if (key === '\x1B[A' || key === '\x1B[D') { // Up arrow
        if (selected > 0) { selected--; redraw(); }
        return;
      }

      if (key === '\x1B[B' || key === '\x1B[C') { // Down arrow
        if (selected < 1) { selected++; redraw(); }
        return;
      }

      if (key === '\r' || key === '\n' || key === ' ') { // Enter / Space
        teardown();
        process.stdout.write('\n');
        resolve(selected === 0 ? 'update' : 'continue');
      }
    }

    stdin.on('data', onKey);
  });
}

function installUpdate(latest: string): never {
  console.log(chalk.cyan(`\n  Instalando ${PACKAGE_NAME}@${latest}...\n`));
  // shell:true so Windows can resolve npm's .cmd shim (CreateProcess can't exec it directly).
  // The spawned args are fixed strings (PACKAGE_NAME is a compile-time constant, the version
  // is the literal "@latest" dist-tag) — no fetched/user-controlled value reaches this call.
  const result = spawnSync('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], {
    stdio: 'inherit',
    shell: true,
  });
  if (result.status === 0) {
    console.log(chalk.green.bold(`\n  ✓ Atualizado para ${latest}. Execute o comando novamente.\n`));
  } else {
    console.error(chalk.red(`\n  ✗ Falha na instalação. Tente manualmente:`));
    console.error(chalk.cyan(`    npm install -g ${PACKAGE_NAME}@latest\n`));
  }
  process.exit(0);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function handleUpdate(current: string, latest: string): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    warnUpdate(current, latest);
    return;
  }

  const choice = await interactiveUpdateMenu(current, latest);

  if (choice === 'update') {
    installUpdate(latest);
  }
  // 'continue' → fall through, command runs normally
}

export async function checkForUpdate(): Promise<void> {
  if (process.env['AION_SKIP_UPDATE_CHECK'] === '1') return;

  const current = getCurrentVersion();
  const cache = readCache();
  const now = Date.now();

  if (cache && isNewer(cache.latestVersion, current)) {
    await handleUpdate(current, cache.latestVersion);
    return;
  }

  const stale = shouldRefreshUpdateCache(cache, current, now);
  if (stale) {
    const latest = await Promise.race([
      fetchLatest(),
      new Promise<null>((r) => setTimeout(() => r(null), 2000)),
    ]);
    if (latest) {
      writeCache({ checkedAt: now, latestVersion: latest, currentVersion: current });
      if (isNewer(latest, current)) await handleUpdate(current, latest);
    }
  }
}
