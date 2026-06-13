import { BaseAgent } from './base-agent.js';
import { buildPlannerPrompt } from '../prompts/planner.js';
import { PlanReportSchema, type PlanReport } from '../schemas/plan.js';
import type { AgentManifest } from '../schemas/agent-manifest.js';
import type { TaskState } from '../core/state-machine.js';
import type { ProviderName } from '../core/runtime-policy.js';

export interface PlannerInput {
  taskId: string;
  bugDescription: string;
  codebaseSummary: string;
  repoContext?: string;
  worktreePath: string;
}

export class PlannerAgent extends BaseAgent<PlannerInput, PlanReport> {
  constructor(provider: ProviderName = 'claude') {
    super({
      name: 'planner',
      provider,
      systemPrompt: buildPlannerPrompt(),
    });
  }

  protected getWorktreePath(input: PlannerInput): string {
    return input.worktreePath;
  }

  protected buildUserMessage(input: PlannerInput): string {
    return `Task ID: ${input.taskId}

Bug / Task:
${input.bugDescription}

Prior context from .ai-memory:
${input.codebaseSummary || '(none)'}

Deterministic repository index context:
${input.repoContext || '(repo index not built; run `ai memory index` for lower-hallucination planning)'}

Use Glob and Grep to explore the project structure.
When reading files, read at most 500 lines from any single file; use focused offset/limit reads.
Then output the plan JSON.`;
  }

  protected parseOutput(text: string): PlanReport {
    const raw = this.parseJson<unknown>(text, 'PlannerAgent');
    const result = PlanReportSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`PlannerAgent schema error: ${result.error.message}`);
    }
    return result.data;
  }

  protected resolveState(_output: PlanReport): TaskState {
    return 'INVESTIGATING';
  }
}

export const manifest: AgentManifest = {
  name: 'planner',
  description: 'Produces a structured fix plan with file targets and steps',
  outputSchema: 'PlanReportSchema',
  retryStrategy: 'context-reduction',
  requiresWorktree: true,
  failureBehavior: 'throw',
};
