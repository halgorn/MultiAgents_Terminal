import { BaseAgent } from './base-agent.js';
import { buildInvestigatorPrompt, type InvestigatorDomain } from '../prompts/investigator.js';
import { EvidenceReportSchema, type EvidenceReport } from '../schemas/evidence.js';
import type { PlanReport } from '../schemas/plan.js';
import type { TaskState } from '../core/state-machine.js';
import type { ProviderName } from '../core/runtime-policy.js';

export interface InvestigatorInput {
  plan: PlanReport;
  bugDescription: string;
  worktreePath: string;
  domain: InvestigatorDomain;
}

export class InvestigatorAgent extends BaseAgent<InvestigatorInput, EvidenceReport> {
  constructor(private readonly domain: InvestigatorDomain, provider: ProviderName = 'codex') {
    super({
      name: `investigator-${domain}`,
      provider,
      systemPrompt: buildInvestigatorPrompt(domain),
    });
  }

  protected getWorktreePath(input: InvestigatorInput): string {
    return input.worktreePath;
  }

  protected buildUserMessage(input: InvestigatorInput): string {
    return `Bug / Task:
${input.bugDescription}

Plan summary:
${input.plan.summary}

Files likely involved (start here):
${input.plan.estimatedFiles.join('\n')}

Modules:
${input.plan.relevantModules.join('\n')}

Domain focus: ${input.domain}

Use Read, Grep, Glob to investigate.
When reading files, read at most 500 lines from any single file; use focused offset/limit reads.
Then output the evidence JSON.`;
  }

  protected parseOutput(text: string): EvidenceReport {
    const raw = this.parseJson<unknown>(text, `InvestigatorAgent(${this.domain})`);
    const result = EvidenceReportSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`InvestigatorAgent(${this.domain}) schema error: ${result.error.message}`);
    }
    return result.data;
  }

  protected resolveState(output: EvidenceReport): TaskState {
    return output.reproduced ? 'REPRODUCED' : 'FAILED';
  }
}
