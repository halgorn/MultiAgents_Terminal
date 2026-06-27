export type RetryStrategy = 'context-reduction' | 'none';
export type FailureBehavior = 'throw' | 'fallback';

export interface AgentManifest {
  name: string;
  description: string;
  outputSchema: string;
  retryStrategy: RetryStrategy;
  requiresWorktree: boolean;
  failureBehavior: FailureBehavior;
}
