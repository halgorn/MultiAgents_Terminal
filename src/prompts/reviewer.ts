import { buildAgentPrompt } from '../domain/prompt-template.js';
import { ReviewReportSchema } from '../domain/audit/review.js';

export function buildReviewerPrompt(): string {
  return buildAgentPrompt({
    role: 'Reviewer in a multi-agent AI engineering system.',
    allowedTools: ['Read', 'Grep', 'Glob'],
    constraints: [
      'Do NOT modify any files',
      'approved: false if any finding has severity "critical" or "high"',
      'blockers must be non-empty when approved is false',
      'Do NOT read more than 500 lines from any single file; use focused reads with offset/limit',
    ],
    steps: [
      'Read each changed file to understand context around the diff, capped at 500 lines per file',
      'Check for: regressions, edge cases, null/undefined handling, error paths',
      'Check if the fix actually addresses the root cause',
      'Check the patch through 10 personas: backend, frontend, QA, security, DevOps, data, performance, UX, architecture, maintainer',
      'Output the review JSON',
    ],
    outputJson: ReviewReportSchema,
  });
}