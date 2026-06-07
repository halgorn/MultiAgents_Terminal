import { getLangfuseTracerProvider, startObservation } from '@langfuse/tracing';

interface LangfuseObservationLike {
  startObservation?: (name: string, input?: unknown, options?: unknown) => LangfuseObservationLike;
  update?: (payload: unknown) => LangfuseObservationLike;
  end?: () => void;
}

function hasLangfuseConfig(): boolean {
  return Boolean(process.env['LANGFUSE_PUBLIC_KEY'] && process.env['LANGFUSE_SECRET_KEY']);
}

export function isLangfuseEnabled(): boolean {
  return hasLangfuseConfig();
}

export function langfuseStatusLine(): string {
  if (!hasLangfuseConfig()) return 'disabled (set LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY)';
  const baseUrl = process.env['LANGFUSE_BASE_URL'] || 'https://cloud.langfuse.com';
  return `enabled (${baseUrl})`;
}

export function startLangfuseRootObservation(command: string, cwd: string): LangfuseObservationLike | null {
  if (!hasLangfuseConfig()) return null;
  try {
    return startObservation(`aion.${command}`, {
      input: { command, cwd },
      metadata: { source: 'aion-cli' },
    }) as unknown as LangfuseObservationLike;
  } catch {
    return null;
  }
}

export function startLangfuseChildObservation(
  parent: LangfuseObservationLike | null,
  agentName: string,
): LangfuseObservationLike | null {
  if (!parent?.startObservation) return null;
  try {
    return parent.startObservation(
      `agent.${agentName}`,
      { input: { agentName } },
      { asType: 'tool' },
    ) as unknown as LangfuseObservationLike;
  } catch {
    return null;
  }
}

export function endLangfuseObservation(
  obs: LangfuseObservationLike | null | undefined,
  payload?: unknown,
): void {
  if (!obs) return;
  try {
    if (payload && obs.update) obs.update(payload);
    obs.end?.();
  } catch {
    // best effort only
  }
}

export async function flushLangfuse(): Promise<void> {
  if (!hasLangfuseConfig()) return;
  try {
    const provider = getLangfuseTracerProvider() as unknown as { forceFlush?: () => Promise<void> };
    if (provider && typeof provider.forceFlush === 'function') {
      await provider.forceFlush();
    }
  } catch {
    // best effort only
  }
}
