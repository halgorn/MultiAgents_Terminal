import { EventEmitter } from 'events';
import type { TaskResult } from './task.js';
import type { TaskState } from './state-machine.js';
import { KnowledgeStore } from '../infra/knowledge.js';
import { createRuntimePolicy, type RuntimePolicy, type RuntimePolicyInput } from './runtime-policy.js';
import type { AuditReport } from '../schemas/audit.js';
import { CostTracker } from './cost-tracker.js';
import { AuditPipeline } from './pipelines/audit-pipeline.js';
import { runFixPipeline } from './pipelines/fix-pipeline.js';
import { runAnalyzePipeline } from './pipelines/analyze-pipeline.js';
import { runReviewPipeline } from './pipelines/review-pipeline.js';
import { runAuditFixPipeline, type AuditFixOptions, type AuditFixReport } from './pipelines/audit-fix-pipeline.js';
import type { ScanDomain } from '../prompts/scanner.js';
import type { PipelineContext } from './pipeline-context.js';

export interface OrchestratorEvents {
  'state:change': { taskId: string; state: TaskState };
  'agent:output': { agentName: string; text: string };
  'agent:start': { agentName: string };
  'agent:done': { agentName: string; durationMs: number };
  error: { taskId: string; message: string };
}

export class Orchestrator extends EventEmitter {
  private readonly knowledge: KnowledgeStore;
  private readonly policy: RuntimePolicy;
  readonly costs = new CostTracker();

  constructor(private readonly cwd: string, policyInput: RuntimePolicyInput = {}) {
    super();
    this.knowledge = new KnowledgeStore(cwd);
    this.policy = createRuntimePolicy(policyInput);
  }

  // TOKEN_PATTERN: matches " tokens:IN:OUT:CACHE_READ:CACHE_WRITE "
  private static readonly TOKEN_RE = /tokens:(\d+):(\d+):(\d+):(\d+)/;
  private static readonly USAGE_UNAVAILABLE_RE = /usage-unavailable/;

  private onChunk = (agentName: string, text: string): void => {
    const match = Orchestrator.TOKEN_RE.exec(text);
    if (match) {
      this.costs.record(agentName, this.policy.claudeModel, {
        inputTokens: parseInt(match[1]!),
        outputTokens: parseInt(match[2]!),
        cacheReadTokens: parseInt(match[3]!),
        cacheWriteTokens: parseInt(match[4]!),
      }, 0);
      return;
    }
    if (Orchestrator.USAGE_UNAVAILABLE_RE.test(text)) {
      this.costs.recordUnavailable(agentName);
      return;
    }
    this.emit('agent:output', { agentName, text });
  };

  private get pipelineContext(): PipelineContext {
    return {
      cwd: this.cwd,
      policy: this.policy,
      knowledge: this.knowledge,
      emit: this.emit.bind(this),
      onChunk: this.onChunk,
    };
  }

  async runFixPipeline(target: string): Promise<TaskResult> {
    return runFixPipeline(this.pipelineContext, target);
  }

  async runAnalyzePipeline(target: string): Promise<TaskResult> {
    return runAnalyzePipeline(this.pipelineContext, target);
  }

  async runReviewPipeline(target: string): Promise<TaskResult> {
    return runReviewPipeline(this.pipelineContext, target);
  }

  async runAuditFixPipeline(auditReport: AuditReport, options?: AuditFixOptions): Promise<AuditFixReport> {
    return runAuditFixPipeline(this.pipelineContext, auditReport, options);
  }

  async runAuditPipeline(target: string, numScanners?: number, explicitDomains?: ScanDomain[]): Promise<AuditReport> {
    const pipeline = new AuditPipeline(
      this.cwd,
      this.policy,
      this.costs,
      (event, payload) => this.emit(event, payload),
      this.onChunk,
    );
    return pipeline.run(target, numScanners, explicitDomains);
  }
}
