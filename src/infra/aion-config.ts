import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ProviderName, BudgetName } from '../core/runtime-policy.js';
import type { FixSeverity } from '../schemas/audit.js';
import { AION_CONFIG_FILE } from './paths.js';

const CONFIG_FILE = AION_CONFIG_FILE;

export interface AionConfig {
  /** Default persona preset: security | ai | backend | devops | quality | saas | fintech | full */
  preset?: string;
  /** Default budget */
  budget?: BudgetName;
  /** Default AI provider */
  provider?: ProviderName;
  /** Default model override (for openrouter) */
  model?: string;
  /** Extra glob patterns to ignore during audit (merged with .aionignore) */
  ignore?: string[];
  /** Default domains (comma-separated), overrides preset if set */
  domains?: string[];
  /** Default max auto-fixes */
  fixMax?: number;
  /** Default minimum severity to auto-fix */
  fixMinSeverity?: FixSeverity;
  /** Default scanner count override */
  scanners?: number;
}

export function loadAionConfig(cwd: string): AionConfig {
  const path = join(cwd, CONFIG_FILE);
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as AionConfig;
  } catch { return {}; }
}

/** Merge config defaults under CLI options (CLI wins) */
export function mergeConfig<T extends Record<string, unknown>>(
  cliOpts: T,
  config: AionConfig,
  defaults: Partial<T> = {},
): T {
  const result = { ...defaults } as Record<string, unknown>;
  // Apply config fields only if CLI option is not set
  const configMap: Record<string, keyof AionConfig> = {
    preset: 'preset',
    budget: 'budget',
    provider: 'provider',
    model: 'model',
    domains: 'domains',
    fixMax: 'fixMax',
    fixMinSeverity: 'fixMinSeverity',
    scanners: 'scanners',
  };
  for (const [cliKey, configKey] of Object.entries(configMap)) {
    const configVal = config[configKey];
    const cliVal = cliOpts[cliKey];
    if (configVal !== undefined && (cliVal === undefined || cliVal === null)) {
      result[cliKey] = Array.isArray(configVal) ? (configVal as string[]).join(',') : configVal;
    }
  }
  // CLI overrides everything
  for (const [k, v] of Object.entries(cliOpts)) {
    if (v !== undefined && v !== null) result[k] = v;
  }
  return result as T;
}

export function generateDefaultConfig(): AionConfig {
  return {
    domains: ['bugs'],
    budget: 'low',
    scanners: 1,
    provider: 'claude',
    ignore: ['**/fixtures/**', '**/testdata/**', '**/*.generated.*'],
    fixMax: 5,
    fixMinSeverity: 'high',
  };
}

export function writeDefaultConfig(cwd: string): string {
  const config = generateDefaultConfig();
  return writeAionConfig(cwd, config);
}

export function writeAionConfig(cwd: string, config: AionConfig): string {
  const path = join(cwd, CONFIG_FILE);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return path;
}
