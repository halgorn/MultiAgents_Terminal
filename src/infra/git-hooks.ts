import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const HOOK_MARKER = '# aion-index';
const HOOK_LINE = `${HOOK_MARKER}\naion index --quiet 2>/dev/null || true\n`;

function hooksDir(cwd: string): string | null {
  const dir = join(cwd, '.git', 'hooks');
  return existsSync(join(cwd, '.git')) ? dir : null;
}

export function installPostCommitHook(cwd: string): boolean {
  const dir = hooksDir(cwd);
  if (!dir) return false;

  mkdirSync(dir, { recursive: true });
  const hookPath = join(dir, 'post-commit');

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    // Already installed — skip
    if (existing.includes(HOOK_MARKER)) return true;
    // Append to existing hook
    writeFileSync(hookPath, `${existing.trimEnd()}\n\n${HOOK_LINE}`, 'utf8');
  } else {
    writeFileSync(hookPath, `#!/bin/sh\n\n${HOOK_LINE}`, 'utf8');
  }

  chmodSync(hookPath, 0o755);
  return true;
}

export function isHookInstalled(cwd: string): boolean {
  const dir = hooksDir(cwd);
  if (!dir) return false;
  const hookPath = join(dir, 'post-commit');
  if (!existsSync(hookPath)) return false;
  return readFileSync(hookPath, 'utf8').includes(HOOK_MARKER);
}
