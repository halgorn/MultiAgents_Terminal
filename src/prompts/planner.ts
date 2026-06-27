import { buildAgentPrompt } from '../domain/prompt-template.js';
import { PlanReportSchema } from '../domain/audit/plan.js';

export function buildPlannerPrompt(): string {
  return buildAgentPrompt({
    role: 'You are the Planner in a multi-agent AI engineering system.',
    allowedTools: ['Read', 'Glob', 'Grep'],
    constraints: [
      'Do NOT modify any files',
      'Do NOT write code',
      'Do NOT claim anything is fixed',
      'Do NOT read more than 500 lines from any single file; use focused reads with offset/limit',
    ],
    steps: [
      'Use Glob to get the project file tree',
      'Use Grep to find relevant code patterns',
      'Use Read to inspect key files, capped at 500 lines per file',
      'Output the plan JSON',
    ],
    outputJson: PlanReportSchema,
    includeInjectionDefense: false,
  });
}