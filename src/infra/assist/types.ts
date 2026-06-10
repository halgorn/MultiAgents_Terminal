export type AssistProvider = 'claude' | 'codex' | 'openrouter';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
export type DeployRuntime = 'docker-compose' | 'dockerfile' | 'node' | 'static' | 'unknown';

export interface ProjectDetection {
  cwd: string;
  name: string;
  packageManager: PackageManager;
  runtime: DeployRuntime;
  scripts: Record<string, string>;
  buildCommand: string;
  testCommand: string;
  startCommand: string;
  lintCommand?: string;
  port: number;
  hasGit: boolean;
  hasDockerfile: boolean;
  hasCompose: boolean;
  hasGitHubActions: boolean;
}

export interface AssistTarget {
  domain: string;
  appPort: number;
  deployPath: string;
  healthPath: string;
  sshHostSecret: string;
  sshUserSecret: string;
  sshKeySecret: string;
}

export interface AssistArtifact {
  path: string;
  kind: 'github-actions' | 'nginx' | 'script' | 'markdown' | 'config';
  content: string;
  executable?: boolean;
}

export interface RemoteStep {
  name: string;
  command: string;
}

export interface AssistPlan {
  version: 1;
  mode: 'ci' | 'deploy' | 'full';
  provider: AssistProvider;
  generatedBy: 'deterministic' | 'ai';
  createdAt: string;
  detection: ProjectDetection;
  target: AssistTarget;
  requiredSecrets: string[];
  localChecks: string[];
  artifacts: AssistArtifact[];
  remoteSteps: RemoteStep[];
  healthcheckUrl: string;
  ciSeoFailUnder?: number;
  notes: string[];
}

export interface AssistBuildOptions {
  mode?: AssistPlan['mode'];
  provider?: AssistProvider;
  domain?: string;
  appPort?: number;
  deployPath?: string;
  healthPath?: string;
  ciSeoFailUnder?: number;
}
