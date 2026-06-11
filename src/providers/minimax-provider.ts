import type { ProviderRunInput, AgentProvider } from './types.js';
import { runSseCompletion } from './sse-completion.js';

const MINIMAX_API_URL = 'https://api.minimax.io/v1/chat/completions';

export class MiniMaxProvider implements AgentProvider {
  readonly name = 'minimax' as const;

  constructor(private readonly model: string) {}

  async run(
    input: ProviderRunInput,
    onChunk?: (agentName: string, text: string) => void,
  ): Promise<string> {
    const apiKey = process.env['MINIMAX_API_KEY'];
    if (!apiKey) throw new Error('MINIMAX_API_KEY is not set');
    return runSseCompletion({ url: MINIMAX_API_URL, apiKey, providerName: 'MiniMax', model: this.model, input, onChunk });
  }
}
