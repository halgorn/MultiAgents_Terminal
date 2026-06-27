import type { RuntimePolicy } from '../core/runtime-policy.js';

export interface ProviderRunInput {
  agentName: string;
  cwd: string;
  systemPrompt: string;
  userMessage: string;
  policy: RuntimePolicy;
}

export interface TokenUsage {
  agentName: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model?: string;
  costUsd?: number;
  timestamp: string;
}

export interface ProviderCapabilities {
  readonly hasToolAccess: boolean;
  readonly hasFileAccess: boolean;
  readonly supportsJsonSchema: boolean;
  readonly supportsEmbeddings: boolean;
  readonly maxContextTokens: number;
}

export interface AgentProvider {
  readonly name: string;
  readonly capabilities?: ProviderCapabilities;
  run(input: ProviderRunInput, onChunk?: (agentName: string, text: string) => void, onUsage?: (usage: TokenUsage) => void): Promise<string>;
  runWithFiles?(input: ProviderRunInput, filePaths: readonly string[], onChunk?: (agentName: string, text: string) => void): Promise<string>;
}

export const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  hasToolAccess: false,
  hasFileAccess: false,
  supportsJsonSchema: false,
  supportsEmbeddings: false,
  maxContextTokens: 8000,
};

export function mergeCapabilities(base: ProviderCapabilities, override: Partial<ProviderCapabilities>): ProviderCapabilities {
  return { ...base, ...override };
}