import { BaseAgent } from './base-agent.js';
import { buildReviewerPrompt } from '../prompts/reviewer.js';
import { ReviewReportSchema, type ReviewReport } from '../schemas/review.js';
import type { PatchReport } from '../schemas/patch.js';
import type { EvidenceReport } from '../schemas/evidence.js';
import type { TaskState } from '../core/state-machine.js';
import type { ProviderName } from '../core/runtime-policy.js';

export interface ReviewerInput {
  patch: PatchReport;
  evidence: EvidenceReport;
  worktreePath: string;
}

export class ReviewerAgent extends BaseAgent<ReviewerInput, ReviewReport> {
  constructor(provider: ProviderName = 'claude') {
    super({
      name: 'reviewer',
      provider,
      systemPrompt: buildReviewerPrompt(),
    });
  }

  protected getWorktreePath(input: ReviewerInput): string {
    return input.worktreePath;
  }

  protected buildUserMessage(input: ReviewerInput): string {
    return `Patch description:
${input.patch.description}

Files changed:
${input.patch.filesChanged.join('\n')}

Diff:
${input.patch.diff}

Developer-noted risks:
${input.patch.risksIntroduced.join('\n') || 'none'}

Original root cause:
${input.evidence.rootCause ?? input.evidence.summary}

Use Read to inspect the changed files in context, reading at most 500 lines from any single file.
Review through these 10 concise personas: backend, frontend, QA, security, DevOps, data, performance, UX, architecture, maintainer.
Then output the review JSON.`;
  }

  protected parseOutput(text: string): ReviewReport {
    const raw = this.parseJson<unknown>(text, 'ReviewerAgent');
    const result = ReviewReportSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`ReviewerAgent schema error: ${result.error.message}`);
    }
    return result.data;
  }

  protected resolveState(output: ReviewReport): TaskState {
    return output.approved ? 'REVIEWED' : 'FAILED';
  }
}
