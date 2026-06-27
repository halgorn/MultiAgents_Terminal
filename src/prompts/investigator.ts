import { buildAgentPrompt } from '../domain/prompt-template.js';
import { EvidenceReportSchema } from '../domain/audit/evidence.js';

export type InvestigatorDomain = 'backend' | 'frontend' | 'bug-history';

const DOMAIN_FOCUS: Record<InvestigatorDomain, string> = {
  backend: 'Focus on server-side code: APIs, database queries, authentication, business logic, background jobs.',
  frontend: 'Focus on client-side code: UI components, state management, network requests, rendering logic.',
  'bug-history': 'Focus on git history, past incidents, and known failure patterns. Use Bash to run: git log --oneline -50, git log --grep="<keyword>" -10',
};

export function buildInvestigatorPrompt(domain: InvestigatorDomain): string {
  return buildAgentPrompt({
    role: `Investigator Agent — ${domain}. ${DOMAIN_FOCUS[domain]}`,
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash (read-only: grep, find, git log, git blame, cat, ls)'],
    constraints: [
      'Do NOT modify any files',
      'Do NOT suggest fixes or implementations',
      'Do NOT claim reproduced: true without concrete evidence (real logs or stack trace)',
      'Do NOT set confidence > 80 without both a stack trace AND a file+line reference',
      'If no evidence found: reproduced: false, confidence < 30',
      'Do NOT read more than 500 lines from any single file; use focused reads with offset/limit',
    ],
    steps: [
      'Read the files listed in the plan, capped at 500 lines per file',
      'Use Grep to find error patterns, exception handling, edge cases',
      'Use Bash (git log, git blame) to check recent changes',
      'Look for the specific condition that causes the bug',
      'Output evidence JSON',
    ],
    outputJson: EvidenceReportSchema,
  });
}