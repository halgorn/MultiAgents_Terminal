import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { AI_RUNTIME_DIR } from '../infra/paths.js';

export interface MenuPrefs {
  lastAuditMode?: 'local-only' | 'normal';
  recentFiles?: string[];
  provider?: string;
}

function prefsPath(cwd: string): string {
  return join(cwd, AI_RUNTIME_DIR, 'menu-prefs.json');
}

export function loadMenuPrefs(cwd: string): MenuPrefs {
  try {
    const p = prefsPath(cwd);
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, 'utf8')) as MenuPrefs;
  } catch { return {}; }
}

export function saveMenuPrefs(cwd: string, partial: Partial<MenuPrefs>): void {
  try {
    const p = prefsPath(cwd);
    mkdirSync(dirname(p), { recursive: true });
    const current = loadMenuPrefs(cwd);
    writeFileSync(p, JSON.stringify({ ...current, ...partial }, null, 2), 'utf8');
  } catch { /* best-effort */ }
}

export function addRecentFile(cwd: string, file: string): void {
  const prefs = loadMenuPrefs(cwd);
  const recent = [file, ...(prefs.recentFiles ?? []).filter((f) => f !== file)].slice(0, 8);
  saveMenuPrefs(cwd, { recentFiles: recent });
}

export function getRecentFiles(cwd: string): string[] {
  return loadMenuPrefs(cwd).recentFiles ?? [];
}
