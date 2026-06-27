export type FlowFailureStrategy = 'abort' | 'skip-and-continue' | 'fallback';

export interface FlowManifest {
  name: string;
  description: string;
  inputDescription: string;
  outputSchema: string;
  agentSequence: string[];
  failureStrategy: FlowFailureStrategy;
}
