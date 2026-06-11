import type { ProviderRunInput, AgentProvider } from './types.js';
import { runSseCompletion } from './sse-completion.js';

const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';

export class KimiProvider implements AgentProvider {
  readonly name = 'kimi' as const;

  constructor(private readonly model: string) {}

  async run(
    input: ProviderRunInput,
    onChunk?: (agentName: string, text: string) => void,
  ): Promise<string> {
    const apiKey = process.env['MOONSHOT_API_KEY'];
    if (!apiKey) throw new Error('MOONSHOT_API_KEY is not set');
    return runSseCompletion({ url: KIMI_API_URL, apiKey, providerName: 'Kimi', model: this.model, input, onChunk });
  }
}
