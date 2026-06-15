import type { Command } from 'commander';
import { addRuntimeOptions, type RuntimeCliOptions } from '../runtime-options.js';
import { runAnalyzeViaLangGraph } from '../../core/langgraph-orchestrator.js';
import { runWithOrchestrator } from '../run-with-orchestrator.js';

export function registerAnalyze(program: Command): void {
  addRuntimeOptions(program
    .command('analyze <target>')
    .description('Analyze a bug or issue with budgeted investigators'))
    .action(async (target: string, options: RuntimeCliOptions) => {
      await runWithOrchestrator('analyze', options, (orch) => runAnalyzeViaLangGraph(orch, target),
        (r) => r.state === 'DONE' || r.state === 'REPRODUCED');
    });
}
