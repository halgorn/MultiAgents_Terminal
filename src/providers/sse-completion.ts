import { limitChars } from '../core/runtime-policy.js';
import type { ProviderRunInput } from './types.js';

const AGENT_TIMEOUT_MS = 10 * 60 * 1000;

export interface SseCompletionOptions {
  url: string;
  apiKey: string;
  providerName: string;
  model: string;
  input: ProviderRunInput;
  onChunk?: (agentName: string, text: string) => void;
  extraHeaders?: Record<string, string>;
}

export async function runSseCompletion(opts: SseCompletionOptions): Promise<string> {
  const { url, apiKey, providerName, model, input, onChunk, extraHeaders } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  let fullText = '';

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userMessage },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${providerName} API error ${res.status}: ${body}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error(`No response body from ${providerName} API`);

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
          if (text) { fullText += text; onChunk?.(input.agentName, text); }
          if (event.usage) {
            inputTokens = event.usage.prompt_tokens ?? 0;
            outputTokens = event.usage.completion_tokens ?? 0;
          }
        } catch { /* skip malformed SSE lines */ }
      }
    }

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
