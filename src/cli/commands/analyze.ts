import type { Command } from 'commander';
import { Orchestrator } from '../../core/orchestrator.js';
import { Renderer } from '../ui/renderer.js';

export function registerAnalyze(program: Command): void {
  program
    .command('analyze <target>')
    .description('Spawn parallel investigators to analyze a bug or issue')
    .action(async (target: string) => {
      const renderer = new Renderer();
      const orch = new Orchestrator(process.cwd());

      orch.on('state:change', ({ state }) => renderer.showState(state));
      orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
      orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
      orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));
      orch.on('error', ({ message }) => renderer.showError(message));

      const result = await orch.runAnalyzePipeline(target);
      renderer.showResult(result);

      process.exit(result.state === 'DONE' || result.state === 'REPRODUCED' ? 0 : 1);
    });
}
