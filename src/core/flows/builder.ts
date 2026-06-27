import type { TaskState } from './state-machine.js';

export type FailureStrategy = 'abort' | 'skip-and-continue' | 'fallback';

export interface StepContext<S> {
  state: S;
  input: S;
  stepIndex: number;
  totalSteps: number;
  signal?: AbortSignal;
  emit?(event: string, payload: unknown): void;
}

export interface StepResult<O> {
  state: TaskState;
  output: O;
}

export interface FallbackResult<O> {
  state: TaskState;
  output: O;
  reason: string;
}

export interface FlowStep<I, O> {
  name: string;
  run: (ctx: StepContext<I>) => Promise<StepResult<O>>;
  failureStrategy: FailureStrategy;
  fallback?: (err: Error, ctx: StepContext<I>) => Promise<FallbackResult<O>>;
  timeoutMs?: number;
  onError?: (err: Error, ctx: StepContext<I>) => void;
}

export interface FanOutStep<I, O> {
  name: string;
  branches: Array<{ name: string; run: (ctx: StepContext<I>) => Promise<StepResult<O>> }>;
  failureStrategy: FailureStrategy;
  concurrency?: number;
  merge?: (outputs: O[]) => O;
}

export type AnyStep<I, O> = FlowStep<I, O> | FanOutStep<I, O>;

export interface Flow<I, O> {
  name: string;
  steps: ReadonlyArray<AnyStep<I, O>>;
  initialState: TaskState;
  run(ctx: StepContext<I>): Promise<StepResult<O>>;
}

export class FlowBuilder<I, O> {
  private steps: AnyStep<I, O>[] = [];
  private initial: TaskState = 'PENDING';
  private defaultTimeoutMs?: number;

  constructor(private readonly name: string) {}

  initialState(state: TaskState): this {
    this.initial = state;
    return this;
  }

  defaultTimeout(ms: number): this {
    this.defaultTimeoutMs = ms;
    return this;
  }

  step<S extends O>(
    name: string,
    run: (ctx: StepContext<I>) => Promise<StepResult<S>>,
    opts: Partial<Omit<FlowStep<I, S>, 'name' | 'run'>> = {},
  ): FlowBuilder<I, O> {
    const next = new FlowBuilder<I, O>(this.name);
    next.steps = [
      ...this.steps,
      { name, run, failureStrategy: opts.failureStrategy ?? 'abort', fallback: opts.fallback, timeoutMs: opts.timeoutMs ?? this.defaultTimeoutMs, onError: opts.onError },
    ];
    next.initial = this.initial;
    next.defaultTimeoutMs = this.defaultTimeoutMs;
    return next;
  }

  fanOut<S extends O>(
    name: string,
    branches: Array<{ name: string; run: (ctx: StepContext<I>) => Promise<StepResult<S>> }>,
    opts: Partial<Omit<FanOutStep<I, S>, 'name' | 'branches'>> = {},
  ): FlowBuilder<I, O> {
    const next = new FlowBuilder<I, O>(this.name);
    next.steps = [
      ...this.steps,
      { name, branches, failureStrategy: opts.failureStrategy ?? 'skip-and-continue', concurrency: opts.concurrency ?? 3, merge: opts.merge },
    ];
    next.initial = this.initial;
    next.defaultTimeoutMs = this.defaultTimeoutMs;
    return next;
  }

  build(): Flow<I, O> {
    const flow: Flow<I, O> = {
      name: this.name,
      steps: this.steps,
      initialState: this.initial,
      async run(ctx: StepContext<I>): Promise<StepResult<O>> {
        let state = flow.initialState;
        let lastOutput: unknown = undefined;
        for (let i = 0; i < flow.steps.length; i++) {
          const step = flow.steps[i]!;
          const stepCtx: StepContext<I> = { ...ctx, state: state as never, input: ctx.input, stepIndex: i, totalSteps: flow.steps.length };
          try {
            if ('branches' in step) {
              const branchResults = await runFanOut(step, stepCtx);
              lastOutput = step.merge ? step.merge(branchResults.map((r) => r.output)) : branchResults[branchResults.length - 1]?.output;
              state = branchResults[branchResults.length - 1]?.state ?? state;
            } else {
              const result = await runStep(step, stepCtx);
              lastOutput = result.output;
              state = result.state;
            }
          } catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            step.onError?.(e, stepCtx);
            if (step.failureStrategy === 'abort') {
              ctx.emit?.('flow:failed', { flow: flow.name, step: step.name, error: e.message });
              throw e;
            }
            if (step.failureStrategy === 'fallback' && 'fallback' in step && step.fallback) {
              const fb = await step.fallback(e, stepCtx);
              lastOutput = fb.output;
              state = fb.state;
              ctx.emit?.('flow:fallback', { flow: flow.name, step: step.name, reason: fb.reason });
              continue;
            }
            ctx.emit?.('flow:skipped', { flow: flow.name, step: step.name, error: e.message });
          }
        }
        return { state, output: lastOutput as O };
      },
    };
    return flow;
  }
}

export function flow<I, O>(name: string): FlowBuilder<I, O> {
  return new FlowBuilder<I, O>(name);
}

async function runStep<I, O>(step: FlowStep<I, O>, ctx: StepContext<I>): Promise<StepResult<O>> {
  if (!step.timeoutMs) return await step.run(ctx);
  return await Promise.race([
    step.run(ctx),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Step '${step.name}' timed out after ${step.timeoutMs}ms`)), step.timeoutMs),
    ),
  ]);
}

async function runFanOut<I, O>(step: FanOutStep<I, O>, ctx: StepContext<I>): Promise<StepResult<O>[]> {
  const limit = step.concurrency ?? step.branches.length;
  const slots = Math.max(1, Math.min(step.branches.length, limit));
  const results: Array<StepResult<O> | undefined> = new Array(step.branches.length);
  let nextIdx = 0;
  const workers = Array.from({ length: slots }, async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= step.branches.length) return;
      const branch = step.branches[i]!;
      try {
        results[i] = await branch.run(ctx);
      } catch (err) {
        if (step.failureStrategy === 'abort') throw err;
      }
    }
  });
  await Promise.all(workers);
  return results.filter((r): r is StepResult<O> => r !== undefined);
}