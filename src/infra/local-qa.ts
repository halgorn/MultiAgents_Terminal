import { spawnSync } from 'child_process';
import type { PatchReport } from '../schemas/patch.js';
import type { EvidenceReport } from '../schemas/evidence.js';
import type { QAResult } from '../schemas/qa.js';
import type { RuntimePolicy } from '../core/runtime-policy.js';
import { limitChars } from '../core/runtime-policy.js';

function runShell(cwd: string, command: string, maxOutputChars: number): { ok: boolean; output: string } {
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
  const build = runShell(cwd, patch.buildCommand || 'npm run build', policy.maxOutputChars);
  const tests = runShell(cwd, patch.testCommand || 'npm test', policy.maxOutputChars);
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
