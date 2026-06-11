import type { Command } from 'commander';
import { Orchestrator } from '../../core/orchestrator.js';
import { Renderer } from '../ui/renderer.js';
import { addRuntimeOptions, toRuntimePolicyInput, type RuntimeCliOptions } from '../runtime-options.js';
import { runAnalyzeViaLangGraph } from '../../infra/langgraph-orchestrator.js';

export function registerAnalyze(program: Command): void {
  addRuntimeOptions(program
    .command('analyze <target>')
    .description('Analyze a bug or issue with budgeted investigators'))
    .action(async (target: string, options: RuntimeCliOptions) => {
      const renderer = new Renderer();
      const orch = new Orchestrator(process.cwd(), toRuntimePolicyInput(options));

      orch.on('state:change', ({ state }) => renderer.showState(state));
      orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
      orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
      orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));
      orch.on('error', ({ message }) => renderer.showError(message));

      orch.startTrace('analyze');
      try {
        const result = await runAnalyzeViaLangGraph(orch, target);
        renderer.showResult(result);
        renderer.showCost(orch.costs.summary());
        process.exit(result.state === 'DONE' || result.state === 'REPRODUCED' ? 0 : 1);
      } finally {
        await orch.flushTrace();
      }
    });
}
