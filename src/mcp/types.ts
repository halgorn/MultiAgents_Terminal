export type Confidence = 'high' | 'medium' | 'stale';

export type Audience = 'user' | 'assistant' | 'both';

export type FreshnessPolicy = 'realtime' | 'sync' | 'lazy';

export interface McpResponseMeta {
  pilVersion: number;
  indexedAt: string;
  filesTotal: number;
  filesChangedSince: number;
  confidence: Confidence;
  syncRecommended: boolean;
  estTokens: number;
  traceId: string;
  tool?: string;
  resource?: string;
  durationMs?: number;
  status?: 'ok' | 'error';
  error?: string;
}

export interface FreshnessConfig {
  highMaxChanged: number;
  staleMinChanged: number;
  staleAgeSec: number;
}

export const DEFAULT_FRESHNESS: FreshnessConfig = {
  highMaxChanged: 0,
  staleMinChanged: 3,
  staleAgeSec: 1800,
};

export interface ResourceAnnotation {
  audience: Audience;
  priority: number;
  freshness: FreshnessPolicy;
  tokenCost: number;
  description: string;
}

export interface ResourceDescriptor {
  uri: string;
  name: string;
  mimeType: string;
  annotations: ResourceAnnotation;
  handler: (args: ResourceArgs) => Promise<ResourceResult>;
}

export interface ResourceArgs {
  cwd: string;
  params: Record<string, string>;
}

export interface ResourceResult {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
  meta?: McpResponseMeta;
}

export interface PromptDescriptor {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
  handler: (args: Record<string, string>) => Promise<PromptResult>;
}

export interface PromptResult {
  messages: Array<{
    role: 'user' | 'assistant';
    content: { type: 'text'; text: string };
  }>;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  estimatedTokens: number;
  handler: (args: Record<string, unknown>, ctx: HandlerContext) => Promise<ToolResult>;
}

export interface HandlerContext {
  cwd: string;
  traceId: string;
  startedAt: number;
}

export interface ToolResult {
  content: string;
  meta?: Partial<McpResponseMeta>;
}

export interface ObservabilityEntry {
  traceId: string;
  ts: string;
  tool?: string;
  resource?: string;
  durationMs: number;
  status: 'ok' | 'error';
  estTokens: number;
  args?: Record<string, unknown>;
  error?: string;
}

export interface McpServerOptions {
  cwd: string;
  autoSync: boolean;
  watch: boolean;
  tokenBudget: number;
  logFile: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  freshness: FreshnessConfig;
  autoResync: boolean;
  allowedRoots: string[];
}

export const DEFAULT_MCP_OPTIONS: McpServerOptions = {
  cwd: '.',
  autoSync: true,
  watch: true,
  tokenBudget: 1500,
  logFile: '.ai-runtime/mcp.log',
  logLevel: 'info',
  freshness: DEFAULT_FRESHNESS,
  autoResync: true,
  allowedRoots: ['src', 'lib'],
};

export function defaultMcpOptions(overrides: Partial<McpServerOptions> = {}): McpServerOptions {
  return { ...DEFAULT_MCP_OPTIONS, ...overrides };
}

export function resolveAudience(value: string | undefined): Audience {
  if (value === 'user' || value === 'assistant' || value === 'both') return value;
  return 'both';
}

export function resolveFreshness(value: string | undefined): FreshnessPolicy {
  if (value === 'realtime' || value === 'sync' || value === 'lazy') return value;
  return 'sync';
}

export function clampPriority(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
