import type { Command } from 'commander';
import { addRuntimeOptions, type RuntimeCliOptions } from '../runtime-options.js';
import { runFixViaLangGraph } from '../../core/langgraph-orchestrator.js';
import { runWithOrchestrator } from '../run-with-orchestrator.js';

export function registerFix(program: Command): void {
  addRuntimeOptions(program
    .command('fix <target>')
    .description('Full fix pipeline: Planner -> Investigator -> Developer -> Reviewer -> local QA'))
    .action(async (target: string, options: RuntimeCliOptions) => {
      await runWithOrchestrator('fix', options, (orch) => runFixViaLangGraph(orch, target));
    });
}
