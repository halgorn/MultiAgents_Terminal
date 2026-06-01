import type { Command } from 'commander';
import { Orchestrator } from '../../core/orchestrator.js';
import { Renderer } from '../ui/renderer.js';
import { addRuntimeOptions, toRuntimePolicyInput, type RuntimeCliOptions } from '../runtime-options.js';

export function registerFix(program: Command): void {
  addRuntimeOptions(program
    .command('fix <target>')
    .description('Full fix pipeline: Planner -> Investigator -> Developer -> Reviewer -> local QA'))
    .action(async (target: string, options: RuntimeCliOptions) => {
      const renderer = new Renderer();
      const orch = new Orchestrator(process.cwd(), toRuntimePolicyInput(options));

      orch.on('state:change', ({ state }) => renderer.showState(state));
      orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
      orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
      orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));
      orch.on('error', ({ message }) => renderer.showError(message));

      const result = await orch.runFixPipeline(target);
      renderer.showResult(result);

      process.exit(result.state === 'DONE' ? 0 : 1);
    });
}
