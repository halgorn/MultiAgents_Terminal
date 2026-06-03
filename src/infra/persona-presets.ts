import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ScanDomain } from '../prompts/scanner.js';

export interface PersonaPreset {
  name: string;
  description: string;
  domains: ScanDomain[];
}

export interface CustomPersona {
  name: string;
  title: string;
  grepPatterns: string[];
  instructions: string;
}

export interface PersonaConfig {
  presets?: Record<string, { description: string; domains: string[] }>;
  custom?: CustomPersona[];
}

// Built-in presets for common project types
export const BUILT_IN_PRESETS: Record<string, PersonaPreset> = {
  security: {
    name: 'security',
    description: 'Full security review: vulnerabilities, secrets, compliance, supply chain',
    domains: ['security', 'compliance', 'dependencies', 'multitenancy'],
  },
  ai: {
    name: 'ai',
    description: 'AI/LLM project: agents, prompts, RAG, observability',
    domains: ['prompt-audit', 'security', 'resilience', 'observability', 'data'],
  },
  backend: {
    name: 'backend',
    description: 'Backend API: security, data, error handling, resilience, performance',
    domains: ['security', 'data', 'error-handling', 'resilience', 'performance'],
  },
  devops: {
    name: 'devops',
    description: 'Infrastructure and operations: K8s, observability, resilience, dependencies',
    domains: ['infrastructure', 'observability', 'resilience', 'dependencies'],
  },
  quality: {
    name: 'quality',
    description: 'Code quality: bugs, architecture, testing, redundancy, maintainability',
    domains: ['bugs', 'architecture', 'testing', 'redundancy', 'error-handling'],
  },
  saas: {
    name: 'saas',
    description: 'SaaS product: multitenancy, compliance, security, resilience, observability',
    domains: ['multitenancy', 'compliance', 'security', 'resilience', 'observability'],
  },
  fintech: {
    name: 'fintech',
    description: 'Fintech/regulated: compliance, security, data, multitenancy, audit trail',
    domains: ['compliance', 'security', 'data', 'multitenancy', 'error-handling'],
  },
  full: {
    name: 'full',
    description: 'All 15 domains (slow but complete)',
    domains: [
      'security', 'bugs', 'redundancy', 'error-handling', 'architecture',
      'testing', 'performance', 'infrastructure', 'observability', 'resilience',
      'data', 'dependencies', 'compliance', 'multitenancy', 'prompt-audit',
    ],
  },
};

export function listPresets(): void {
  console.log('\nBuilt-in presets:\n');
  for (const [key, preset] of Object.entries(BUILT_IN_PRESETS)) {
    console.log(`  --preset ${key.padEnd(12)} ${preset.description}`);
    console.log(`               domains: ${preset.domains.join(', ')}\n`);
  }
}

export function resolvePreset(name: string): PersonaPreset | null {
  return BUILT_IN_PRESETS[name] ?? null;
}

export function parseDomains(raw: string): ScanDomain[] {
  const valid = new Set<string>([
    'security', 'bugs', 'redundancy', 'error-handling', 'architecture',
    'testing', 'performance', 'infrastructure', 'observability', 'resilience',
    'data', 'dependencies', 'compliance', 'multitenancy', 'prompt-audit',
  ]);
  return raw.split(',')
    .map((d) => d.trim())
    .filter((d) => valid.has(d)) as ScanDomain[];
}

export function loadPersonaConfig(cwd: string): PersonaConfig | null {
  const paths = [
    join(cwd, '.ai-personas.json'),
    join(cwd, '.ai-runtime', 'personas.json'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try { return JSON.parse(readFileSync(p, 'utf8')) as PersonaConfig; } catch { /* skip */ }
  }
  return null;
}

export function resolveDomainsFromConfig(
  cwd: string,
  preset?: string,
  domainsArg?: string,
  numScanners?: number,
): { domains: ScanDomain[]; source: string } {
  // 1. Explicit domains list
  if (domainsArg) {
    const domains = parseDomains(domainsArg);
    if (domains.length > 0) return { domains, source: `custom: ${domains.join(', ')}` };
  }

  // 2. Named preset (built-in or custom from file)
  if (preset) {
    const config = loadPersonaConfig(cwd);
    const customPreset = config?.presets?.[preset];
    if (customPreset) {
      const domains = parseDomains(customPreset.domains.join(','));
      return { domains, source: `preset:${preset} (custom)` };
    }
    const builtin = resolvePreset(preset);
    if (builtin) {
      const domains = numScanners ? builtin.domains.slice(0, numScanners) : builtin.domains;
      return { domains, source: `preset:${preset}` };
    }
    console.warn(`Unknown preset "${preset}" — falling back to default`);
  }

  // 3. Default: first N from SCAN_DOMAINS
  return { domains: [], source: 'auto' };
}
