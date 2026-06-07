import { spawnSync } from 'child_process';
import type { AssistPlan, RemoteStep } from './types.js';

const DANGEROUS_RE = /(?:^|\s)(rm|mkfs|dd|shutdown|reboot|chmod\s+777|chown\s+-R)\b|[;&|`$><]/;
const ALLOWED_PREFIXES = [
  'mkdir -p ',
  'cp ',
  'docker compose ',
  'systemctl restart ',
  'systemctl reload ',
  'nginx -t',
  'curl --fail ',
  'curl --fail --silent --show-error ',
  'npm ',
  'pnpm ',
  'yarn ',
  'bun ',
  'echo ',
];

export interface StepValidation {
  ok: boolean;
  reason?: string;
}

export interface RemoteExecutionResult {
  dryRun: boolean;
  commands: string[];
  ok: boolean;
  output: string;
}

export function validateRemoteStep(step: RemoteStep): StepValidation {
  const command = step.command.trim();
  if (!command) return { ok: false, reason: `${step.name}: empty command` };
  if (DANGEROUS_RE.test(command)) return { ok: false, reason: `${step.name}: dangerous shell syntax or command` };
  if (!ALLOWED_PREFIXES.some((prefix) => command === prefix.trim() || command.startsWith(prefix))) {
    return { ok: false, reason: `${step.name}: command is not allowlisted: ${command}` };
  }
  return { ok: true };
}

export function validateRemoteSteps(steps: RemoteStep[]): string[] {
  return steps
    .map(validateRemoteStep)
    .filter((result) => !result.ok)
    .map((result) => result.reason ?? 'invalid remote step');
}

function sshTarget(plan: AssistPlan): string {
  return `\${${plan.target.sshUserSecret}}@\${${plan.target.sshHostSecret}}`;
}

export function buildSshCommands(plan: AssistPlan): string[] {
  return plan.remoteSteps.map((step) => `ssh ${sshTarget(plan)} ${JSON.stringify(step.command)}`);
}

export function executeRemotePlan(plan: AssistPlan, options: { dryRun?: boolean; yes?: boolean } = {}): RemoteExecutionResult {
  const dryRun = options.dryRun !== false || !options.yes;
  const errors = validateRemoteSteps(plan.remoteSteps);
  if (errors.length > 0) {
    return { dryRun, commands: [], ok: false, output: errors.join('\n') };
  }

  const commands = buildSshCommands(plan);
  if (dryRun) {
    return { dryRun: true, commands, ok: true, output: commands.join('\n') };
  }

  const output: string[] = [];
  for (const step of plan.remoteSteps) {
    const result = spawnSync('ssh', [sshTarget(plan), step.command], {
      encoding: 'utf8',
      shell: false,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    output.push(`$ ${step.command}`);
    if (result.stdout) output.push(result.stdout.trim());
    if (result.stderr) output.push(result.stderr.trim());
    if (result.status !== 0) {
      return { dryRun: false, commands, ok: false, output: output.join('\n') };
    }
  }
  return { dryRun: false, commands, ok: true, output: output.join('\n') };
}

export function runHealthcheck(url: string): RemoteExecutionResult {
  if (!/^https?:\/\/[^\s]+$/.test(url)) {
    return { dryRun: false, commands: [], ok: false, output: `Invalid healthcheck URL: ${url}` };
  }
  const args = ['--fail', '--silent', '--show-error', '--max-time', '20', url];
  const result = spawnSync('curl', args, {
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return {
    dryRun: false,
    commands: [`curl ${args.join(' ')}`],
    ok: result.status === 0,
    output: [result.stdout ?? '', result.stderr ?? '', result.error?.message ?? ''].filter(Boolean).join('\n').trim(),
  };
}
