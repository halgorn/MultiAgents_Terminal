import type { RuntimePolicy } from '../core/runtime-policy.js';

export interface ProviderRunInput {
  agentName: string;
  cwd: string;
  systemPrompt: string;
  userMessage: string;
  policy: RuntimePolicy;
}

export interface AgentProvider {
  readonly name: string;
  run(input: ProviderRunInput, onChunk?: (agentName: string, text: string) => void): Promise<string>;
}
