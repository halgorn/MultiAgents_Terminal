import { Orchestrator } from '../core/orchestrator.js';
import { Renderer } from './ui/renderer.js';
import { toRuntimePolicyInput, type RuntimeCliOptions } from './runtime-options.js';
import type { TaskResult } from '../core/task.js';

export async function runWithOrchestrator(
  command: string,
  options: RuntimeCliOptions,
  fn: (orch: Orchestrator) => Promise<TaskResult>,
  successCheck: (result: TaskResult) => boolean = (r) => r.state === 'DONE',
): Promise<void> {
  const renderer = new Renderer();
  const orch = new Orchestrator(process.cwd(), toRuntimePolicyInput(options));

  orch.on('state:change', ({ state }) => renderer.showState(state));
  orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
  orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
  orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));
  orch.on('error', ({ message }) => renderer.showError(message));

  orch.startTrace(command);
  try {
    const result = await fn(orch);
    renderer.showResult(result);
    renderer.showCost(orch.costs.summary());
    await orch.flushTrace();
    process.exit(successCheck(result) ? 0 : 1);
  } catch (err) {
    await orch.flushTrace();
    renderer.showError(err);
    process.exit(1);
  }
}
