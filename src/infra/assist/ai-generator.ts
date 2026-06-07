import { createRuntimePolicy } from '../../core/runtime-policy.js';
import { createProvider } from '../../providers/cli-provider.js';
import type { AssistArtifact, AssistPlan, AssistProvider, RemoteStep } from './types.js';
import { validateRemoteStep } from './remote-executor.js';

interface AiAssistResponse {
  artifacts?: AssistArtifact[];
  remoteSteps?: RemoteStep[];
  notes?: string[];
}

function extractJson(text: string): AiAssistResponse {
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('AI response did not include a JSON object');
  return JSON.parse(cleaned.slice(start, end + 1)) as AiAssistResponse;
}

function validateArtifact(artifact: AssistArtifact): string | null {
  if (!artifact.path || artifact.path.includes('..') || artifact.path.startsWith('/')) return `unsafe artifact path: ${artifact.path}`;
  if (!['github-actions', 'nginx', 'script', 'markdown', 'config'].includes(artifact.kind)) return `unsupported artifact kind: ${artifact.kind}`;
  if (/(BEGIN .*PRIVATE KEY|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,})/.test(artifact.content)) {
    return `artifact appears to contain a secret: ${artifact.path}`;
  }
  return null;
}

export function buildAssistAiPrompt(plan: AssistPlan): string {
  return `You are generating CI/deploy configuration for Aion.

Return ONLY JSON with optional keys: artifacts, remoteSteps, notes.
Never include secret values. Reference secrets only by these names: ${plan.requiredSecrets.join(', ')}.
Do not generate destructive commands. Remote commands must be limited to mkdir, cp, docker compose, systemctl, nginx -t, curl, npm, pnpm, yarn, bun, or echo.

Project:
- name: ${plan.detection.name}
- package manager: ${plan.detection.packageManager}
- runtime: ${plan.detection.runtime}
- build: ${plan.detection.buildCommand || '(none)'}
- test: ${plan.detection.testCommand || '(none)'}
- start: ${plan.detection.startCommand || '(none)'}
- port: ${plan.target.appPort}
- domain: ${plan.target.domain}
- deployPath: ${plan.target.deployPath}

Improve the deterministic artifacts if useful, but keep paths relative and safe.`;
}

export async function generateAiAssistPlan(plan: AssistPlan, providerName: AssistProvider, onChunk?: (text: string) => void): Promise<AssistPlan> {
  const policy = createRuntimePolicy({
    budget: 'low',
    plannerProvider: providerName,
    maxOutputChars: 20_000,
  });
  const provider = createProvider(providerName, policy);
  const text = await provider.run({
    agentName: 'planner',
    cwd: plan.detection.cwd,
    systemPrompt: 'Generate safe deploy configuration as strict JSON. Do not include secrets.',
    userMessage: buildAssistAiPrompt(plan),
    policy,
  }, (_agent, chunk) => onChunk?.(chunk));

  const parsed = extractJson(text);
  const artifacts = parsed.artifacts ?? [];
  const remoteSteps = parsed.remoteSteps ?? [];
  const errors = [
    ...artifacts.map(validateArtifact).filter(Boolean),
    ...remoteSteps.map(validateRemoteStep).filter((result) => !result.ok).map((result) => result.reason),
  ];
  if (errors.length > 0) throw new Error(`AI assist output rejected:\n${errors.join('\n')}`);

  return {
    ...plan,
    provider: providerName,
    generatedBy: 'ai',
    artifacts: artifacts.length > 0 ? artifacts : plan.artifacts,
    remoteSteps: remoteSteps.length > 0 ? remoteSteps : plan.remoteSteps,
    notes: [...plan.notes, ...(parsed.notes ?? [])],
  };
}
