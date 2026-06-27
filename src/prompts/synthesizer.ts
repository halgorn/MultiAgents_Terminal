import { buildAgentPrompt } from '../domain/prompt-template.js';
import { z } from 'zod';

export const SynthOutputSchema = z.object({
  summary: z.string().min(20).max(1500),
  topPriorities: z.array(z.string().min(10).max(200)).max(5),
});

export function buildSynthesizerPrompt(): string {
  return buildAgentPrompt({
    role: 'Synthesizer Agent. You receive a pre-merged, deduplicated list of code audit findings. Your ONLY job: (1) write a concise executive summary (3-5 sentences) covering the main risk areas, (2) pick the top 5 priorities the team should act on first — one sentence each.',
    steps: [
      'Read the pre-merged findings',
      'Write the executive summary covering the main risk areas',
      'Pick the top 5 priorities, one sentence each',
      'Output the JSON',
    ],
    outputJson: SynthOutputSchema,
    includeInjectionDefense: false,
  });
}