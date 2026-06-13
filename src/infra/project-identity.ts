import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type ProjectType =
  | 'cli_tool'
  | 'web_app'
  | 'backend_api'
  | 'sdk'
  | 'npm_package'
  | 'framework'
  | 'multi_agent_framework'
  | 'agent_platform'
  | 'scraper'
  | 'browser_extension'
  | 'desktop_app'
  | 'monorepo'
  | 'library';

export type ExecutionModel = 'local' | 'server' | 'browser' | 'hybrid';

export interface TrustBoundary {
  trusted: string[];
  semi_trusted: string[];
  untrusted: string[];
}

export interface ProjectIdentity {
  primary_type: ProjectType;
  secondary_types: ProjectType[];
  execution_model: ExecutionModel;
  confidence: number;
  trust_boundaries: TrustBoundary;
  signals: string[];
}

function readPkg(cwd: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function hasDep(pkg: Record<string, unknown>, ...names: string[]): string | null {
  const deps = Object.assign({}, pkg['dependencies'] as object, pkg['devDependencies'] as object);
  for (const n of names) if (n in deps) return n;
  return null;
}

function dirExists(cwd: string, dir: string): boolean {
  return existsSync(join(cwd, dir));
}

function fileExists(cwd: string, file: string): boolean {
  return existsSync(join(cwd, file));
}

const TRUST_MODELS: Record<string, TrustBoundary> = {
  cli_tool: {
    trusted: ['internal constants', 'config files', 'hardcoded defaults'],
    semi_trusted: ['CLI arguments', 'env vars', 'local files specified by user'],
    untrusted: ['user file content', 'piped stdin from unknown sources'],
  },
  web_app: {
    trusted: ['env vars', 'config files'],
    semi_trusted: ['authenticated session', 'internal API calls'],
    untrusted: ['HTTP body', 'URL params', 'query strings', 'file uploads', 'cookies'],
  },
  backend_api: {
    trusted: ['env vars', 'config files'],
    semi_trusted: ['authenticated tokens', 'internal service calls'],
    untrusted: ['request body', 'path params', 'client headers', 'external webhooks'],
  },
  multi_agent_framework: {
    trusted: ['internal constants', 'config files', 'hardcoded prompts'],
    semi_trusted: ['user config', 'CLI flags', 'env vars'],
    untrusted: ['agent outputs', 'external data ingested by agents', 'plugin data'],
  },
};

function trustFor(type: ProjectType): TrustBoundary {
  return TRUST_MODELS[type] ?? TRUST_MODELS['cli_tool']!;
}

export function detectProjectIdentity(cwd: string): ProjectIdentity {
  const pkg = readPkg(cwd);
  const signals: string[] = [];
  const scores: Partial<Record<ProjectType, number>> = {};

  function bump(type: ProjectType, pts: number, signal: string) {
    scores[type] = (scores[type] ?? 0) + pts;
    signals.push(signal);
  }

  // ── CLI ──────────────────────────────────────────────────────────────────
  if (pkg['bin']) bump('cli_tool', 30, 'package.json has "bin" field');
  const kws = (pkg['keywords'] as string[] | undefined) ?? [];
  if (kws.some((k) => ['cli', 'command-line', 'command'].includes(k.toLowerCase()))) {
    bump('cli_tool', 20, 'keywords include cli/command-line');
  }
  const cliDep = hasDep(pkg, 'commander', 'yargs', 'meow', 'oclif', 'clipanion', 'cac');
  if (cliDep) bump('cli_tool', 25, `uses CLI framework: ${cliDep}`);
  if (dirExists(cwd, 'src/cli')) bump('cli_tool', 15, 'src/cli/ directory found');
  if (hasDep(pkg, 'ink')) bump('cli_tool', 15, 'uses ink (terminal UI)');

  // ── Web app ───────────────────────────────────────────────────────────────
  const webDep = hasDep(pkg, 'next', 'nuxt', 'gatsby', 'remix', 'astro', '@sveltejs/kit');
  if (webDep) bump('web_app', 30, `uses web framework: ${webDep}`);
  const uiDep = hasDep(pkg, 'react', 'vue', 'svelte', 'solid-js', 'preact');
  if (uiDep) bump('web_app', 15, `uses UI library: ${uiDep}`);
  if (dirExists(cwd, 'pages') || dirExists(cwd, 'app')) bump('web_app', 10, 'web page directory found');

  // ── Backend API ───────────────────────────────────────────────────────────
  const apiDep = hasDep(pkg, 'express', 'fastify', 'koa', 'hapi', 'restify', '@nestjs/core');
  if (apiDep) bump('backend_api', 30, `uses API framework: ${apiDep}`);
  const ormDep = hasDep(pkg, 'prisma', 'typeorm', 'sequelize', 'mongoose', 'drizzle-orm');
  if (ormDep) bump('backend_api', 15, `uses ORM: ${ormDep}`);
  if (dirExists(cwd, 'routes') || dirExists(cwd, 'controllers')) bump('backend_api', 10, 'API directory structure found');

  // ── Multi-agent / AI framework ────────────────────────────────────────────
  const aiDep = hasDep(pkg, '@anthropic-ai/sdk', 'openai', 'langchain', '@langchain/core', 'ai', 'ollama', 'groq-sdk');
  if (aiDep) bump('multi_agent_framework', 25, `uses AI SDK: ${aiDep}`);
  if (dirExists(cwd, 'agents') || dirExists(cwd, 'src/agents')) bump('multi_agent_framework', 20, 'agents/ directory found');
  if (dirExists(cwd, 'flows') || dirExists(cwd, 'src/flows')) bump('multi_agent_framework', 15, 'flows/ directory found');
  if (kws.some((k) => ['agent', 'llm', 'ai', 'multi-agent'].includes(k.toLowerCase()))) {
    bump('multi_agent_framework', 15, 'keywords include agent/llm/ai');
  }

  // ── Desktop app ───────────────────────────────────────────────────────────
  const desktopDep = hasDep(pkg, 'electron', 'tauri', '@tauri-apps/api');
  if (desktopDep) bump('desktop_app', 40, `uses desktop framework: ${desktopDep}`);

  // ── Browser extension ─────────────────────────────────────────────────────
  if (fileExists(cwd, 'manifest.json')) bump('browser_extension', 30, 'manifest.json found');

  // ── Library / SDK ─────────────────────────────────────────────────────────
  const name = (pkg['name'] as string | undefined) ?? '';
  if (name.includes('-sdk') || name.includes('/sdk')) bump('sdk', 20, 'package name contains "-sdk"');
  if (!pkg['bin'] && pkg['main'] && !cliDep && !webDep && !apiDep && !aiDep) {
    bump('library', 10, 'has main export without cli/web/api/ai deps');
  }

  // ── Monorepo ──────────────────────────────────────────────────────────────
  if (fileExists(cwd, 'pnpm-workspace.yaml') || fileExists(cwd, 'lerna.json') || (pkg['workspaces'])) {
    bump('monorepo', 40, 'workspace config found');
  }

  // ── Execution model ───────────────────────────────────────────────────────
  let execution_model: ExecutionModel = 'local';
  if (fileExists(cwd, 'Dockerfile') || fileExists(cwd, 'docker-compose.yml')) {
    execution_model = scores.cli_tool ? 'hybrid' : 'server';
    signals.push('Dockerfile/docker-compose found');
  } else if (scores.web_app || scores.backend_api) {
    execution_model = 'server';
  } else if (scores.browser_extension) {
    execution_model = 'browser';
  }

  // ── Winner ────────────────────────────────────────────────────────────────
  const sorted = (Object.entries(scores) as Array<[ProjectType, number]>).sort((a, b) => b[1] - a[1]);
  const primary_type: ProjectType = sorted[0]?.[0] ?? 'npm_package';
  const topScore = sorted[0]?.[1] ?? 0;
  const secondary_types = sorted.slice(1, 3).filter(([, s]) => s > 0).map(([t]) => t);
  const confidence = Math.min(99, Math.round((topScore / 55) * 100));

  return {
    primary_type,
    secondary_types,
    execution_model,
    confidence,
    trust_boundaries: trustFor(primary_type),
    signals: [...new Set(signals)],
  };
}

export function formatIdentityForPrompt(id: ProjectIdentity): string {
  const lines = [
    `## Project Context`,
    `Primary type: ${id.primary_type}  (confidence: ${id.confidence}%)`,
    id.secondary_types.length > 0 ? `Also: ${id.secondary_types.join(', ')}` : '',
    `Execution model: ${id.execution_model}`,
    `Trusted inputs: ${id.trust_boundaries.trusted.join(', ')}`,
    `Semi-trusted inputs: ${id.trust_boundaries.semi_trusted.join(', ')}`,
    `Untrusted inputs: ${id.trust_boundaries.untrusted.join(', ')}`,
    ``,
    `Apply findings relative to this context. A pattern that is critical in a web_app`,
    `may be expected/informational in a ${id.primary_type}.`,
  ].filter((l) => l !== undefined);
  return lines.join('\n');
}
