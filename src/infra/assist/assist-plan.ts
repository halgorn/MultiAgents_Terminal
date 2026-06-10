import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { detectProject } from './project-detector.js';
import { generateArtifacts } from './generators/artifacts.js';
import type { AssistBuildOptions, AssistPlan, AssistTarget, RemoteStep } from './types.js';

const PLAN_PATH = join('.ai-runtime', 'assist', 'deploy-plan.json');

function slug(input: string): string {
  return input.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'app';
}

function defaultTarget(name: string, options: AssistBuildOptions): AssistTarget {
  const appSlug = slug(name);
  const domain = options.domain ?? `${appSlug}.example.com`;
  const appPort = options.appPort ?? 3000;
  const healthPath = options.healthPath ?? '/';
  return {
    domain,
    appPort,
    deployPath: options.deployPath ?? `/opt/${appSlug}`,
    healthPath,
    sshHostSecret: 'SSH_HOST',
    sshUserSecret: 'SSH_USER',
    sshKeySecret: 'SSH_PRIVATE_KEY',
  };
}

function remoteSteps(plan: Omit<AssistPlan, 'artifacts' | 'remoteSteps'>): RemoteStep[] {
  const restart = plan.detection.hasCompose
    ? `docker compose -f ${plan.target.deployPath}/release/docker-compose.yml up -d --build`
    : `${plan.detection.packageManager === 'pnpm' ? 'pnpm' : plan.detection.packageManager === 'yarn' ? 'yarn' : plan.detection.packageManager === 'bun' ? 'bun' : 'npm'} --prefix ${plan.target.deployPath}/release start`;
  return [
    { name: 'create deploy directories', command: `mkdir -p ${plan.target.deployPath}/release ${plan.target.deployPath}/previous` },
    { name: 'validate nginx config', command: 'nginx -t' },
    { name: 'start application', command: restart },
    { name: 'healthcheck', command: `curl --fail --silent --show-error --max-time 20 ${plan.healthcheckUrl}` },
  ];
}

export function buildAssistPlan(cwd: string, options: AssistBuildOptions = {}): AssistPlan {
  const detection = detectProject(cwd);
  const target = defaultTarget(detection.name, { appPort: detection.port, ...options });
  const ciSeoFailUnder = options.ciSeoFailUnder ? Math.max(0, Math.min(100, options.ciSeoFailUnder)) : undefined;
  const base = {
    version: 1 as const,
    mode: options.mode ?? 'full' as const,
    provider: options.provider ?? 'claude' as const,
    generatedBy: 'deterministic' as const,
    createdAt: new Date().toISOString(),
    detection,
    target,
    requiredSecrets: [target.sshHostSecret, target.sshUserSecret, target.sshKeySecret],
    localChecks: [
      detection.buildCommand,
      detection.testCommand,
      detection.lintCommand,
      'aion scan secrets',
      'aion audit . --dry-run --max-files 20',
    ].filter(Boolean) as string[],
    healthcheckUrl: `http://${target.domain}${target.healthPath}`,
    ciSeoFailUnder,
    notes: [
      'Dry-run is the default. Remote deploy requires explicit apply confirmation.',
      'Secrets are referenced by name only and are never included in AI prompts.',
    ],
  };
  const withSteps = { ...base, remoteSteps: remoteSteps(base) };
  return { ...withSteps, artifacts: generateArtifacts(withSteps as AssistPlan) };
}

export function assistPlanPath(cwd: string): string {
  return join(cwd, PLAN_PATH);
}

export function saveAssistPlan(cwd: string, plan: AssistPlan): string {
  const path = assistPlanPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(plan, null, 2), 'utf8');
  return path;
}

export function loadAssistPlan(path: string): AssistPlan {
  const full = resolve(path);
  if (!existsSync(full)) throw new Error(`Assist plan not found: ${full}`);
  return JSON.parse(readFileSync(full, 'utf8')) as AssistPlan;
}

export function validateAssistPlan(plan: AssistPlan): string[] {
  const errors: string[] = [];
  if (plan.version !== 1) errors.push('unsupported plan version');
  if (!plan.target.domain || /\s/.test(plan.target.domain)) errors.push('target domain is invalid');
  if (!Number.isInteger(plan.target.appPort) || plan.target.appPort <= 0 || plan.target.appPort > 65535) errors.push('target appPort is invalid');
  if (!plan.target.deployPath.startsWith('/')) errors.push('deployPath must be absolute');
  if (plan.artifacts.some((artifact) => artifact.path.includes('..') || artifact.path.startsWith('/'))) {
    errors.push('artifact paths must be relative and stay inside the project');
  }
  return errors;
}
