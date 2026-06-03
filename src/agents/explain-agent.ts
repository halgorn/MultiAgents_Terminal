import { BaseAgent } from './base-agent.js';
import { buildExplainPrompt, type ExplainMode } from '../prompts/explain.js';
import type { TaskState } from '../core/state-machine.js';

export interface ExplainInput {
  worktreePath: string;
  mode: ExplainMode;
  target: string;            // file path or 'project'
  context: string;           // pre-built context block
}

export class ExplainAgent extends BaseAgent<ExplainInput, string> {
  constructor(mode: ExplainMode) {
    super({
      name: `explain-${mode}`,
      provider: 'claude',
      systemPrompt: buildExplainPrompt(mode),
    });
  }

  protected getWorktreePath(input: ExplainInput): string {
    return input.worktreePath;
  }

  protected buildUserMessage(input: ExplainInput): string {
    const modeLabel = { explain: 'Explain', impact: 'Impact analysis', onboard: 'Onboarding guide' }[input.mode];
    return `${modeLabel} for: ${input.target}

${input.context}

Use the Read tool to inspect the file content and any relevant imports before answering.
Output your analysis directly — no JSON wrapper needed.`;
  }

  protected parseOutput(text: string): string {
    return text.trim();
  }

  protected resolveState(_output: string): TaskState {
    return 'DONE';
  }
}
