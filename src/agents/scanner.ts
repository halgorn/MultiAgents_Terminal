import { readFileSync } from 'fs';
import { join } from 'path';
import { BaseAgent } from './base-agent.js';
import { buildScannerPrompt, type ScanDomain, type ScannerContext } from '../prompts/scanner.js';
import { ScanReportSchema, type ScanReport } from '../schemas/audit.js';
import type { TaskState } from '../core/state-machine.js';
import type { ProviderName } from '../core/runtime-policy.js';

const CLI_PROVIDERS: ProviderName[] = ['claude', 'codex'];

export interface ScannerInput {
  domain: ScanDomain;
  worktreePath: string;
  scannerIndex: number;
  totalScanners: number;
  context?: ScannerContext;
}

export class ScannerAgent extends BaseAgent<ScannerInput, ScanReport> {
  constructor(domain: ScanDomain, index: number, total: number, ctx?: ScannerContext, private readonly providerName: ProviderName = 'claude') {
    super({
      name: `scanner-${domain}`,
      provider: providerName,
      systemPrompt: buildScannerPrompt(domain, index, total, ctx),
    });
  }

  protected getWorktreePath(input: ScannerInput): string {
    return input.worktreePath;
  }

  protected buildUserMessage(input: ScannerInput): string {
    if (CLI_PROVIDERS.includes(this.providerName)) {
      return `Run your ${input.domain} audit on this codebase now. Use Grep and Bash to find issues, then Read only the relevant sections to confirm. Output the findings JSON.`;
    }

    // For HTTP providers (no tool access): embed file contents directly
    const files = input.context?.targetFiles ?? [];
    const snippets = files.slice(0, 20).map((f) => {
      try {
        const content = readFileSync(join(input.worktreePath, f), 'utf8');
        const lines = content.split('\n').slice(0, 150).join('\n');
        return `### ${f}\n\`\`\`\n${lines}\n\`\`\``;
      } catch { return null; }
    }).filter(Boolean).join('\n\n');

    return `Run your ${input.domain} audit on the files below. Output the findings JSON.\n\n${snippets}`;
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
