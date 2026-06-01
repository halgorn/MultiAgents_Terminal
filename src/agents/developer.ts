import { BaseAgent } from './base-agent.js';
import { buildDeveloperPrompt } from '../prompts/developer.js';
import { PatchReportSchema, type PatchReport } from '../schemas/patch.js';
import type { EvidenceReport } from '../schemas/evidence.js';
import type { PlanReport } from '../schemas/plan.js';
import type { TaskState } from '../core/state-machine.js';
import type { ProviderName } from '../core/runtime-policy.js';

export interface DeveloperInput {
  evidence: EvidenceReport;
  plan: PlanReport;
  worktreePath: string;
}

export class DeveloperAgent extends BaseAgent<DeveloperInput, PatchReport> {
  constructor(provider: ProviderName = 'codex') {
    super({
      name: 'developer',
      provider,
      systemPrompt: buildDeveloperPrompt(),
    });
  }

  protected getWorktreePath(input: DeveloperInput): string {
    return input.worktreePath;
  }

  protected buildUserMessage(input: DeveloperInput): string {
    return `Root cause:
${input.evidence.rootCause ?? input.evidence.summary}

Evidence files:
${input.evidence.files.map((f) => `${f.path}:${f.line} — ${f.snippet}`).join('\n')}

Confidence: ${input.evidence.confidence}%

Constraints from plan:
${input.plan.constraints.join('\n') || 'none'}

Use Read to understand the affected files, reading at most 500 lines from any single file.
Then Edit/Write to apply the fix.
After making changes, run: git diff HEAD to capture the diff.
Then output the patch JSON.`;
  }

  protected parseOutput(text: string): PatchReport {
    const raw = this.parseJson<unknown>(text, 'DeveloperAgent');
    const result = PatchReportSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`DeveloperAgent schema error: ${result.error.message}`);
    }
    return result.data;
  }

  protected resolveState(_output: PatchReport): TaskState {
    return 'PATCH_CREATED';
  }
}
