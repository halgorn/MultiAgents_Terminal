import type { Command } from 'commander';
import { addRuntimeOptions, type RuntimeCliOptions } from '../runtime-options.js';
import { runReviewViaLangGraph } from '../../core/langgraph-orchestrator.js';
import { runWithOrchestrator } from '../run-with-orchestrator.js';

export function registerReview(program: Command): void {
  addRuntimeOptions(program
    .command('review <target>')
    .description('Review a diff or file path for bugs, regressions, and edge cases'))
    .action(async (target: string, options: RuntimeCliOptions) => {
      await runWithOrchestrator('review', options, (orch) => runReviewViaLangGraph(orch, target),
        (r) => r.state === 'REVIEWED');
    });
}
