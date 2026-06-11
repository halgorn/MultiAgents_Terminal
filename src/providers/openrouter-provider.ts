import type { ProviderRunInput, AgentProvider } from './types.js';
import { runSseCompletion } from './sse-completion.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://www.npmjs.com/package/@aionlabsai/aion',
  'X-Title': 'Aion',
};

export class OpenRouterProvider implements AgentProvider {
  readonly name = 'openrouter' as const;

  constructor(private readonly model: string) {}

  async run(
    input: ProviderRunInput,
    onChunk?: (agentName: string, text: string) => void,
  ): Promise<string> {
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
    return runSseCompletion({
      url: OPENROUTER_API_URL,
      apiKey,
      providerName: 'OpenRouter',
      model: this.model,
      input,
      onChunk,
      extraHeaders: OPENROUTER_HEADERS,
    });
  }
}
