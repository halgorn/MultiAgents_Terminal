import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { TaskResult } from './task.js';
import type { Orchestrator } from './orchestrator.js';

const LangGraphState = Annotation.Root({
  target: Annotation<string>(),
  result: Annotation<TaskResult | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
});

function isLangGraphEnabled(): boolean {
  return process.env['AION_ORCHESTRATOR'] === 'langgraph';
}

export async function runAnalyzeViaLangGraph(orch: Orchestrator, target: string): Promise<TaskResult> {
  if (!isLangGraphEnabled()) return orch.runAnalyzePipeline(target);

  const graph = new StateGraph(LangGraphState)
    .addNode('analyze', async (state) => ({
      result: await orch.runAnalyzePipeline(state.target),
    }))
    .addEdge(START, 'analyze')
    .addEdge('analyze', END)
    .compile();

  const out = await graph.invoke({ target, result: null });
  if (!out.result) throw new Error('LangGraph analyze did not return a result.');
  return out.result;
}

export async function runFixViaLangGraph(orch: Orchestrator, target: string): Promise<TaskResult> {
  if (!isLangGraphEnabled()) return orch.runFixPipeline(target);

  const graph = new StateGraph(LangGraphState)
    .addNode('fix', async (state) => ({
      result: await orch.runFixPipeline(state.target),
    }))
    .addEdge(START, 'fix')
    .addEdge('fix', END)
    .compile();

  const out = await graph.invoke({ target, result: null });
  if (!out.result) throw new Error('LangGraph fix did not return a result.');
  return out.result;
}

export async function runReviewViaLangGraph(orch: Orchestrator, target: string): Promise<TaskResult> {
  if (!isLangGraphEnabled()) return orch.runReviewPipeline(target);

  const graph = new StateGraph(LangGraphState)
    .addNode('review', async (state) => ({
      result: await orch.runReviewPipeline(state.target),
    }))
    .addEdge(START, 'review')
    .addEdge('review', END)
    .compile();

  const out = await graph.invoke({ target, result: null });
  if (!out.result) throw new Error('LangGraph review did not return a result.');
  return out.result;
}
