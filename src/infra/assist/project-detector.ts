import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { DeployRuntime, PackageManager, ProjectDetection } from './types.js';

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

function readPackageJson(cwd: string): PackageJson {
  try {
    return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return {};
  }
}

function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun';
  if (existsSync(join(cwd, 'package-lock.json')) || existsSync(join(cwd, 'package.json'))) return 'npm';
  return 'unknown';
}

function detectRuntime(cwd: string, scripts: Record<string, string>): DeployRuntime {
  if (existsSync(join(cwd, 'docker-compose.yml')) || existsSync(join(cwd, 'compose.yml'))) return 'docker-compose';
  if (existsSync(join(cwd, 'Dockerfile'))) return 'dockerfile';
  if (scripts['start'] || scripts['dev']) return 'node';
  if (existsSync(join(cwd, 'dist')) || existsSync(join(cwd, 'build'))) return 'static';
  return 'unknown';
}

function pmRun(pm: PackageManager, script: string): string {
  if (pm === 'pnpm') return `pnpm ${script}`;
  if (pm === 'yarn') return script === 'install' ? 'yarn install --frozen-lockfile' : `yarn ${script}`;
  if (pm === 'bun') return script === 'install' ? 'bun install --frozen-lockfile' : `bun run ${script}`;
  if (script === 'install') return 'npm ci';
  return `npm run ${script}`;
}

function detectPort(scripts: Record<string, string>): number {
  const text = Object.values(scripts).join('\n');
  const portMatch = /(?:PORT=|--port\s+|--port=)(\d{2,5})/.exec(text);
  if (portMatch?.[1]) return Number(portMatch[1]);
  const localhostMatch = /localhost:(\d{2,5})/.exec(text);
  if (localhostMatch?.[1]) return Number(localhostMatch[1]);
  return 3000;
}

export function detectProject(cwd: string): ProjectDetection {
  const pkg = readPackageJson(cwd);
  const scripts = pkg.scripts ?? {};
  const packageManager = detectPackageManager(cwd);

  return {
    cwd,
    name: pkg.name ?? cwd.split('/').filter(Boolean).pop() ?? 'app',
    packageManager,
    runtime: detectRuntime(cwd, scripts),
    scripts,
    buildCommand: scripts['build'] ? pmRun(packageManager, 'build') : '',
    testCommand: scripts['test'] ? (packageManager === 'npm' ? 'npm test' : pmRun(packageManager, 'test')) : '',
    startCommand: scripts['start'] ? (packageManager === 'npm' ? 'npm start' : pmRun(packageManager, 'start')) : '',
    lintCommand: scripts['lint'] ? pmRun(packageManager, 'lint') : undefined,
    port: detectPort(scripts),
    hasGit: existsSync(join(cwd, '.git')),
    hasDockerfile: existsSync(join(cwd, 'Dockerfile')),
    hasCompose: existsSync(join(cwd, 'docker-compose.yml')) || existsSync(join(cwd, 'compose.yml')),
    hasGitHubActions: existsSync(join(cwd, '.github', 'workflows')),
  };
}
