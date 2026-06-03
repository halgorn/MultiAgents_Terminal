import { BaseAgent } from './base-agent.js';
import { buildScannerPrompt, type ScanDomain, type ScannerContext } from '../prompts/scanner.js';
import { ScanReportSchema, type ScanReport } from '../schemas/audit.js';
import type { TaskState } from '../core/state-machine.js';

export interface ScannerInput {
  domain: ScanDomain;
  worktreePath: string;
  scannerIndex: number;
  totalScanners: number;
  context?: ScannerContext;
}

export class ScannerAgent extends BaseAgent<ScannerInput, ScanReport> {
  constructor(domain: ScanDomain, index: number, total: number, ctx?: ScannerContext) {
    super({
      name: `scanner-${domain}`,
      provider: 'claude',
      systemPrompt: buildScannerPrompt(domain, index, total, ctx),
    });
  }

  protected getWorktreePath(input: ScannerInput): string {
    return input.worktreePath;
  }

  protected buildUserMessage(input: ScannerInput): string {
    return `Run your ${input.domain} audit on this codebase now. Use Grep and Bash to find issues, then Read only the relevant sections to confirm. Output the findings JSON.`;
  }

  protected parseOutput(text: string): ScanReport {
    const raw = this.parseJson<unknown>(text, `ScannerAgent(${this.config.name})`);
    const result = ScanReportSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`ScannerAgent schema error: ${result.error.message}`);
    }
    return result.data;
  }

  protected resolveState(_output: ScanReport): TaskState {
    return 'INVESTIGATING';
  }
}
