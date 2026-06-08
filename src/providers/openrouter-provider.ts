import type { ProviderRunInput, AgentProvider } from './types.js';
import { limitChars } from '../core/runtime-policy.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AGENT_TIMEOUT_MS = 10 * 60 * 1000;

export class OpenRouterProvider implements AgentProvider {
  readonly name = 'openrouter' as const;

  constructor(private readonly model: string) {}

  async run(
    input: ProviderRunInput,
    onChunk?: (agentName: string, text: string) => void,
  ): Promise<string> {
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

    let fullText = '';

    try {
      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://www.npmjs.com/package/@aionlabsai/aion',
          'X-Title': 'Aion',
        },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userMessage },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenRouter error ${res.status}: ${body}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body from OpenRouter');

      const decoder = new TextDecoder();
      let inputTokens = 0;
      let outputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(trimmed.slice(6)) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };

            const text = event.choices?.[0]?.delta?.content ?? '';
            if (text) {
              fullText += text;
              onChunk?.(input.agentName, text);
            }

            if (event.usage) {
              inputTokens = event.usage.prompt_tokens ?? 0;
              outputTokens = event.usage.completion_tokens ?? 0;
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }

      // Emit token accounting in the same format as other providers
      if (inputTokens > 0 || outputTokens > 0) {
        onChunk?.(input.agentName, ` tokens:${inputTokens}:${outputTokens}:0:0 `);
      } else {
        onChunk?.(input.agentName, '\0usage-unavailable\0');
      }

    } finally {
      clearTimeout(timer);
    }

    return limitChars(fullText, input.policy.maxOutputChars);
  }
}
