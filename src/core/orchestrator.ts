import { EventEmitter } from 'events';
import type { TaskResult } from './task.js';
import type { TaskState } from './state-machine.js';
import { KnowledgeStore } from '../infra/knowledge.js';
import { createRuntimePolicy, type RuntimePolicy, type RuntimePolicyInput } from './runtime-policy.js';
import type { AuditReport } from '../schemas/audit.js';
import { CostTracker } from './cost-tracker.js';
import { Tracer } from '../infra/tracer.js';
import { AuditPipeline, type AuditRunOptions } from './pipelines/audit-pipeline.js';
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
  private tracer: Tracer | null = null;

  constructor(private readonly cwd: string, policyInput: RuntimePolicyInput = {}) {
    super();
    this.knowledge = new KnowledgeStore(cwd);
    this.policy = createRuntimePolicy(policyInput);
  }

  // TOKEN_PATTERN: matches " tokens:IN:OUT:CACHE_READ:CACHE_WRITE "
  private static readonly TOKEN_RE = /tokens:(\d+):(\d+):(\d+):(\d+)/;
  private static readonly USAGE_UNAVAILABLE_RE = /usage-unavailable/;

  startTrace(command: string): void {
    this.tracer = new Tracer(command);
  }

  flushTrace(): void {
    this.tracer?.flush(this.cwd);
    this.tracer = null;
  }

  private onChunk = (agentName: string, text: string): void => {
    const match = Orchestrator.TOKEN_RE.exec(text);
    if (match) {
      const input = parseInt(match[1]!, 10);
      const output = parseInt(match[2]!, 10);
      const cacheRead = parseInt(match[3]!, 10);
      const cacheWrite = parseInt(match[4]!, 10);
      this.costs.record(agentName, this.policy.claudeModel, {
        inputTokens: input, outputTokens: output,
        cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite,
      }, 0);
      if (this.tracer) {
        const costUsd = this.costs.byAgent().find((e) => e.agentName === agentName)?.costUsd ?? 0;
        this.tracer.endSpan(agentName, this.policy.claudeModel,
          { input, output, cache: cacheRead + cacheWrite }, costUsd);
      }
      return;
    }
    if (Orchestrator.USAGE_UNAVAILABLE_RE.test(text)) {
      this.costs.recordUnavailable(agentName);
      return;
    }
    this.emit('agent:output', { agentName, text });
  };

  private get pipelineContext(): PipelineContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emit: any = (event: string, payload: unknown) => {
      if (event === 'agent:start' && payload && typeof payload === 'object') {
        this.tracer?.startSpan((payload as Record<string, string>)['agentName'] ?? '');
      }
      return this.emit(event, payload);
    };
    return {
      cwd: this.cwd,
      policy: this.policy,
      knowledge: this.knowledge,
      emit: emit as typeof this.emit,
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

  async runAuditPipeline(
    target: string,
    numScanners?: number,
    explicitDomains?: ScanDomain[],
    options: AuditRunOptions = {},
  ): Promise<AuditReport> {
    const pipeline = new AuditPipeline(
      this.cwd,
      this.policy,
      this.costs,
      (event, payload) => this.emit(event, payload),
      this.onChunk,
    );
    return pipeline.run(target, numScanners, explicitDomains, options);
  }
}
