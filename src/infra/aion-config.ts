import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ProviderName, BudgetName } from '../core/runtime-policy.js';
import type { FixSeverity } from '../schemas/audit.js';
import { AION_CONFIG_FILE } from './paths.js';

const CONFIG_FILE = AION_CONFIG_FILE;

export interface AionConfig {
  preset?: string;
  budget?: BudgetName;
  provider?: ProviderName;
  model?: string;
  ignore?: string[];
  domains?: string[];
  fixMax?: number;
  fixMinSeverity?: FixSeverity;
  scanners?: number;
  notifyWebhook?: string;
  setupCompletedAt?: string;
  setupVersion?: string;
  mcpAutoInstalled?: boolean;
}

export function loadAionConfig(cwd: string): AionConfig {
  const path = join(cwd, CONFIG_FILE);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as AionConfig;
    return raw;
  } catch {
    return {};
  }
}

export function saveAionConfig(cwd: string, config: Partial<AionConfig>): void {
  const path = join(cwd, CONFIG_FILE);
  const existing = loadAionConfig(cwd);
  const merged = { ...existing, ...config };
  writeFileSync(path, JSON.stringify(merged, null, 2), 'utf8');
}

export function hasCompletedSetup(cwd: string): boolean {
  return Boolean(loadAionConfig(cwd).setupCompletedAt);
}

export function markSetupCompleted(cwd: string, version: string): void {
  saveAionConfig(cwd, {
    setupCompletedAt: new Date().toISOString(),
    setupVersion: version,
  });
}

export interface DetectedProvider {
  provider: ProviderName;
  envVar: string;
}

export function detectAvailableProvider(): DetectedProvider | null {
  if (process.env['ANTHROPIC_API_KEY']) return { provider: 'claude', envVar: 'ANTHROPIC_API_KEY' };
  if (process.env['OPENAI_API_KEY']) return { provider: 'codex', envVar: 'OPENAI_API_KEY' };
  if (process.env['OPENROUTER_API_KEY']) return { provider: 'openrouter', envVar: 'OPENROUTER_API_KEY' };
  if (process.env['MOONSHOT_API_KEY']) return { provider: 'kimi', envVar: 'MOONSHOT_API_KEY' };
  if (process.env['MINIMAX_API_KEY']) return { provider: 'minimax', envVar: 'MINIMAX_API_KEY' };
  return null;
}

export interface DetectedMcpClient {
  name: string;
  path: string;
  scope: 'project' | 'global';
}

export function detectMcpClients(cwd: string): DetectedMcpClient[] {
  const results: DetectedMcpClient[] = [];
  const home = process.env['HOME'] ?? '';
  const checks: Array<{ name: string; path: string; scope: 'project' | 'global' }> = [
    { name: 'cursor', path: join(cwd, '.cursor'), scope: 'project' },
    { name: 'claude', path: join(home, '.claude'), scope: 'global' },
    { name: 'codex', path: join(home, '.codex'), scope: 'global' },
    { name: 'opencode', path: join(home, '.config', 'opencode'), scope: 'global' },
  ];
  for (const c of checks) {
    try {
      if (existsSync(c.path)) results.push(c);
    } catch { /* skip */ }
  }
  return results;
}

export function ensureConfigFile(cwd: string): void {
  const path = join(cwd, CONFIG_FILE);
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify({}, null, 2), 'utf8');
  }
}

export function writeAionConfig(cwd: string, config: Partial<AionConfig>): void {
  return saveAionConfig(cwd, config);
}

export function writeDefaultConfig(cwd: string): void {
  ensureConfigFile(cwd);
}


export function mergeConfig<T extends Record<string, unknown>>(base: T, fillIn: Partial<T>): T {
  const result = { ...base };
  for (const [key, value] of Object.entries(fillIn)) {
    if (value === undefined || value === null) continue;
    if (result[key] === undefined || result[key] === null) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
