import { runLocalQA } from '../infra/local-qa.js';
import { QAAgent } from './qa.js';
import { GraphAgent } from './graph-agent.js';
import type { QAResult } from '../schemas/qa.js';
import type { PatchReport } from '../schemas/patch.js';
import type { EvidenceReport } from '../schemas/evidence.js';
import type { RuntimePolicy } from '../core/runtime-policy.js';

export interface TestImpact {
  affectedTestFiles: string[];
  qaResult: QAResult;
}

export class TestsAgent {
  private readonly graph: GraphAgent;

  constructor(private readonly cwd: string) {
    this.graph = new GraphAgent(cwd);
  }

  async run(
    worktreePath: string,
    patch: PatchReport,
    evidence: EvidenceReport,
    policy: RuntimePolicy,
    onChunk?: (agentName: string, text: string) => void,
  ): Promise<TestImpact> {
    const affectedTestFiles = patch.filesChanged.flatMap((f) =>
      this.graph.findTestsForFile(f),
    );

    // Use QAAgent (Claude-driven) when budget allows; fall back to local shell QA
    let qaResult: QAResult;
    if (policy.budget !== 'low') {
      try {
        const run = await new QAAgent().run({ patch, evidence, worktreePath }, policy, onChunk);
        qaResult = run.output;
      } catch {
        qaResult = runLocalQA(worktreePath, patch, evidence, policy);
      }
    } else {
      qaResult = runLocalQA(worktreePath, patch, evidence, policy);
    }

    return { affectedTestFiles, qaResult };
  }

  findImpactedTests(changedFiles: string[]): string[] {
    return changedFiles.flatMap((f) => this.graph.findTestsForFile(f));
  }

  runLocalQA(
    worktreePath: string,
    patch: PatchReport,
    evidence: EvidenceReport,
    policy: RuntimePolicy,
  ): QAResult {
    return runLocalQA(worktreePath, patch, evidence, policy);
  }
}
