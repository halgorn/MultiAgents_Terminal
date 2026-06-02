import { BaseAgent } from './base-agent.js';
import { buildSynthesizerPrompt } from '../prompts/synthesizer.js';
import { AuditReportSchema, type AuditReport, type ScanReport } from '../schemas/audit.js';
import type { TaskState } from '../core/state-machine.js';

export interface SynthesizerInput {
  scanReports: ScanReport[];
  totalFiles: number;
  worktreePath: string;
}

export class SynthesizerAgent extends BaseAgent<SynthesizerInput, AuditReport> {
  constructor() {
    super({
      name: 'synthesizer',
      provider: 'claude',
      systemPrompt: buildSynthesizerPrompt(),
    });
  }

  protected getWorktreePath(input: SynthesizerInput): string {
    return input.worktreePath;
  }

  protected buildUserMessage(input: SynthesizerInput): string {
    const parts = input.scanReports.map((r, i) => {
      const header = `=== Scanner ${i + 1} — ${r.filesScanned.length} files ===`;
      const findingsJson = JSON.stringify(r.findings, null, 2);
      return `${header}\nSummary: ${r.summary}\nFindings:\n${findingsJson}`;
    });

    return `Total files audited: ${input.totalFiles}
Total scanners: ${input.scanReports.length}

${parts.join('\n\n')}

Merge, deduplicate, rank, and output the unified audit report as a JSON object.`;
  }

  protected parseOutput(text: string): AuditReport {
    const raw = this.parseJson<unknown>(text, 'SynthesizerAgent');
    const result = AuditReportSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`SynthesizerAgent schema error: ${result.error.message}`);
    }
    return result.data;
  }

  protected resolveState(_output: AuditReport): TaskState {
    return 'DONE';
  }
}
