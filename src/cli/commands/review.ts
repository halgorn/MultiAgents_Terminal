import type { Command } from 'commander';
import { Orchestrator } from '../../core/orchestrator.js';
import { Renderer } from '../ui/renderer.js';

export function registerReview(program: Command): void {
  program
    .command('review <target>')
    .description('Review a diff or file path for bugs, regressions, and edge cases')
    .action(async (target: string) => {
      const renderer = new Renderer();
      const orch = new Orchestrator(process.cwd());

      orch.on('state:change', ({ state }) => renderer.showState(state));
      orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
      orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
      orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));
      orch.on('error', ({ message }) => renderer.showError(message));

      const result = await orch.runReviewPipeline(target);
      renderer.showResult(result);

      process.exit(result.state === 'REVIEWED' ? 0 : 1);
    });
}
