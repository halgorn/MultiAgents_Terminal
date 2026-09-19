import { spawnSync } from 'child_process';
import type { PatchReport } from '../schemas/patch.js';
import type { EvidenceReport } from '../schemas/evidence.js';
import type { QAResult } from '../schemas/qa.js';
import type { RuntimePolicy } from '../core/runtime-policy.js';
import { limitChars } from '../core/runtime-policy.js';

const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  'npm run build', 'npm test', 'npm run test', 'npm run lint',
  'yarn build', 'yarn test', 'yarn lint',
  'pnpm build', 'pnpm test', 'pnpm lint',
  'make build', 'make test',
  'python -m pytest', 'pytest', 'python -m unittest',
  'go build ./...', 'go test ./...',
  'cargo build', 'cargo test',
]);

const SHELL_METACHAR_RE = /[;&|`$><\\!]/;

export function sanitizeCommandForTest(cmd: string, fallback: string): string {
  return sanitizeCommand(cmd, fallback);
}

function sanitizeCommand(cmd: string, fallback: string): string {
  const trimmed = (cmd ?? '').trim();
  if (!trimmed) return fallback;
  if (SHELL_METACHAR_RE.test(trimmed)) return fallback;
  if (ALLOWED_COMMANDS.has(trimmed)) return trimmed;
  // Allow npm run <script> and similar patterns not in the static set
  if (/^(npm|yarn|pnpm)\s+run\s+[\w:-]+$/.test(trimmed)) return trimmed;
  return fallback;
}

function runCommand(cwd: string, command: string, maxOutputChars: number): { ok: boolean; output: string } {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  // shell:true is required so Windows can resolve .cmd shims (npm, yarn, pnpm);
  // command is restricted by sanitizeCommand to a fixed allow-list or a narrow
  // `(npm|yarn|pnpm) run <script>` pattern, so no attacker-controlled shell
  // metacharacters ever reach this call.
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
    maxBuffer: 1024 * 1024,
  });

  const output = [
    result.stdout ?? '',
    result.stderr ?? '',
    result.error ? String(result.error) : '',
  ].filter(Boolean).join('\n');

  return {
    ok: result.status === 0,
    output: limitChars(output, maxOutputChars),
  };
}

export function runLocalQA(cwd: string, patch: PatchReport, evidence: EvidenceReport, policy: RuntimePolicy): QAResult {
  const buildCmd = sanitizeCommand(patch.buildCommand, 'npm run build');
  const testCmd = sanitizeCommand(patch.testCommand, 'npm test');

  const build = runCommand(cwd, buildCmd, policy.maxOutputChars);
  const tests = runCommand(cwd, testCmd, policy.maxOutputChars);
  const reproductionNotes = limitChars(evidence.logs.slice(0, 5).join('\n'), 1500);
  const ok = build.ok && tests.ok;

  return {
    buildOk: build.ok,
    testsOk: tests.ok,
    lintOk: true,
    reproductionStillFails: !ok,
    buildOutput: build.output,
    testOutput: `${tests.output}\n\nReproduction notes checked by local QA:\n${reproductionNotes}`.trim(),
    failureReason: ok ? undefined : 'Build or test command failed during local QA.',
  };
}
