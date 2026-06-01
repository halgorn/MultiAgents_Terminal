import { BaseAgent } from './base-agent.js';
import { buildQAPrompt } from '../prompts/qa.js';
import { QAResultSchema, type QAResult } from '../schemas/qa.js';
import type { PatchReport } from '../schemas/patch.js';
import type { EvidenceReport } from '../schemas/evidence.js';
import type { TaskState } from '../core/state-machine.js';

export interface QAInput {
  patch: PatchReport;
  evidence: EvidenceReport;
  worktreePath: string;
}

export class QAAgent extends BaseAgent<QAInput, QAResult> {
  constructor() {
    super({
      name: 'qa',
      provider: 'codex',
      systemPrompt: buildQAPrompt(),
    });
  }

  protected getWorktreePath(input: QAInput): string {
    return input.worktreePath;
  }

  protected buildUserMessage(input: QAInput): string {
    return `Build command: ${input.patch.buildCommand}
Test command: ${input.patch.testCommand}

Original bug summary:
${input.evidence.summary}

Reproduction steps (from evidence):
${input.evidence.logs.slice(0, 5).join('\n')}

Use Bash to:
1. Run the build command and capture output
2. Run the test command and capture output
3. Attempt to reproduce the original bug

Then output the QA result JSON with the real command outputs.`;
  }

  protected parseOutput(text: string): QAResult {
    const raw = this.parseJson<unknown>(text, 'QAAgent');
    const result = QAResultSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`QAAgent schema error: ${result.error.message}`);
    }
    return result.data;
  }

  protected resolveState(output: QAResult): TaskState {
    return output.buildOk && output.testsOk && !output.reproductionStillFails ? 'TESTED' : 'FAILED';
  }
}
