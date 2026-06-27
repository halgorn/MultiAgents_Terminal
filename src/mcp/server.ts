import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../infra/logger.js';
import { autoSyncIfNeeded, type AutoSyncResult } from './auto-sync.js';
import { buildResourceList, type ResourceContext } from './resources.js';
import { buildPromptList } from './prompts.js';
import { withObservability } from './observability.js';
import { FileWatcher } from './watcher.js';
import { buildResponseMeta, computeConfidence } from './freshness.js';
import { readProjectStore } from '../infra/project-store.js';
import { defaultMcpOptions, estimateTokens, DEFAULT_FRESHNESS, type McpServerOptions, type ResourceArgs, type ResourceDescriptor, type ResourceResult } from './types.js';
import { safeResolvePath, PathSafetyError } from './path-safety.js';

interface ServerInternals {
  watcher?: FileWatcher;
  wikiRegenTimer?: NodeJS.Timeout;
  resyncInFlight?: Promise<void>;
  notifyResource?: (uri: string) => Promise<void>;
}

const internals: ServerInternals = {};

function getCurrentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname ?? '.', '../../package.json'), 'utf8')) as { version: string };
    return pkg.version;
  } catch { return '0.0.0'; }
}

async function handleSearchMemory(args: Record<string, unknown>, ctx: { cwd: string; traceId: string }): Promise<{ content: string; meta?: Record<string, unknown> }> {
  let cwd: string;
  try {
    cwd = safeResolvePath(ctx.cwd, args['cwd'] as string | null | undefined, { allowEmpty: true });
  } catch (err) {
    if (err instanceof PathSafetyError) return { content: `Invalid cwd: ${err.message}` };
    throw err;
  }
  const query = String(args['query'] ?? '');
  const topK = Math.max(1, Math.min(50, Number(args['topK'] ?? 5) || 5));
  if (!query) return { content: 'Missing required arg: query' };

  const { embedTextRemote, embedText } = await import('../infra/embeddings.js');
  const { createVectorStore } = await import('../infra/vector-store.js');
  const store = createVectorStore(cwd);

  if (store.size() === 0) return { content: 'No vector index. Run `aion memory build` first.' };

  const remote = await embedTextRemote(query);
  const queryVec = remote ?? Array.from(embedText(query, 500));
  const results = await store.search(queryVec, topK);
  if (results.length === 0) return { content: 'No results found.' };
  return {
    content: results.map((r, i) =>
      `[${i + 1}] ${r.payload['file']}:${r.payload['startLine']} — ${r.payload['name']}\n` +
      `    score: ${(r.score * 100).toFixed(1)}%\n` +
      `    ${String(r.payload['preview'] ?? '').split('\n').slice(0, 3).join('\n    ')}`,
    ).join('\n\n'),
  };
}

async function handleDepGraph(_args: Record<string, unknown>, ctx: { cwd: string }): Promise<{ content: string }> {
  const { buildDepGraphAuto, formatDepReport } = await import('../infra/dep-graph.js');
  const graph = buildDepGraphAuto(ctx.cwd);
  return { content: formatDepReport(graph) };
}

async function handleHealthScore(_args: Record<string, unknown>, ctx: { cwd: string }): Promise<{ content: string }> {
  const { computeHealthScore } = await import('../infra/health-score.js');
  const { measureCognitiveLoad } = await import('../infra/code-metrics.js');
  const { collectAuditStats } = await import('../core/pipelines/audit-file-scanner.js');
  const { buildDepGraphAuto } = await import('../infra/dep-graph.js');

  const stats = collectAuditStats(ctx.cwd, '.');
  const graph = buildDepGraphAuto(ctx.cwd);
  const { analyzeChurn } = await import('../infra/git-analysis.js');
  const churn = analyzeChurn(ctx.cwd);
  const cognitive = measureCognitiveLoad(ctx.cwd, 30);

  const score = computeHealthScore({
    totalFiles: stats.totalFiles,
    totalSymbols: 0,
    cycles: graph.cycles.length,
    hotspots: graph.hotspots.length,
    testFileRatio: stats.auditFiles.filter((f) => /\.(test|spec)\./.test(f)).length / Math.max(1, stats.auditFiles.length),
    churn,
    cognitiveLoad: cognitive,
  });
  return { content: JSON.stringify({ total: score.total, grade: score.grade, topRisks: score.topRisks, dimensions: score.dimensions }, null, 2) };
}

async function handleHotZones(args: Record<string, unknown>, ctx: { cwd: string }): Promise<{ content: string }> {
  const limit = Math.max(1, Math.min(100, Number(args['limit'] ?? 10) || 10));
  const { collectAuditStats, fetchGitChurn, prioritizeFiles } = await import('../core/pipelines/audit-file-scanner.js');
  const stats = collectAuditStats(ctx.cwd, '.');
  const top = prioritizeFiles(ctx.cwd, stats.auditFiles, limit);
  const churn = fetchGitChurn(ctx.cwd);
  return { content: top.map((f, i) => `[${i + 1}] ${f} (churn: ${churn.get(f) ?? 0})`).join('\n') };
}

async function handleImpact(args: Record<string, unknown>, ctx: { cwd: string }): Promise<{ content: string }> {
  const fileArg = String(args['file'] ?? '');
  if (!fileArg) return { content: 'Missing required arg: file' };
  let file: string;
  try {
    file = safeResolvePath(ctx.cwd, fileArg);
  } catch (err) {
    if (err instanceof PathSafetyError) return { content: `Invalid file path: ${err.message}` };
    throw err;
  }
  const { buildDepGraphAuto } = await import('../infra/dep-graph.js');
  const graph = buildDepGraphAuto(ctx.cwd);
  const visited = new Set<string>();
  const queue = [file];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [f, node] of graph.nodes) {
      if (node.imports.includes(cur) && !visited.has(f)) {
        visited.add(f);
        queue.push(f);
      }
    }
  }
  if (visited.size === 0) return { content: `No files directly import ${fileArg}.` };
  const files = [...visited].sort();
  return { content: `${files.length} file(s) transitively depend on ${fileArg}:\n` + files.map((f) => `  - ${f}`).join('\n') };
}

export async function startMcpServer(overrides: Partial<McpServerOptions> = {}): Promise<void> {
  const options = defaultMcpOptions(overrides);
  const scopedLog = log.child('mcp.server');
  scopedLog.info('starting MCP server', { version: getCurrentVersion(), cwd: options.cwd });

  const resourceCtx: ResourceContext = { cwd: options.cwd, traceId: 'init', watcher: undefined };
  const resources = buildResourceList(resourceCtx);
  const prompts = buildPromptList();

  const server = new Server(
    { name: 'aion', version: getCurrentVersion() },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  internals.notifyResource = async (uri: string) => {
    try {
      await server.sendResourceUpdated({ uri });
      scopedLog.debug('resource updated notification sent', { uri });
    } catch (err) {
      scopedLog.debug('resource notification failed', { uri, error: String(err) });
    }
  };

  let autoSyncResult: AutoSyncResult | null = null;
  if (options.autoSync) {
    autoSyncResult = await autoSyncIfNeeded({ cwd: options.cwd, config: options.freshness, skipEmbeddings: false, quiet: true });
    scopedLog.info('auto-sync complete', { result: autoSyncResult });
  }

  const watcher = options.watch
    ? new FileWatcher({
        cwd: options.cwd,
        roots: options.allowedRoots,
        watchRootFiles: true,
        onChange: (file) => {
          scopedLog.info('file changed', { file });
          scheduleWikiRegen(options);
        },
      })
    : undefined;
  if (watcher) {
    watcher.start();
    internals.watcher = watcher;
    scopedLog.info('watcher started', { roots: options.allowedRoots });
  }

  resourceCtx.watcher = watcher;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'search_memory', description: 'Semantic search over source code chunks', inputSchema: { type: 'object', properties: { query: { type: 'string' }, topK: { type: 'number', default: 5 }, cwd: { type: 'string' } }, required: ['query'] } },
      { name: 'get_dep_graph', description: 'Read the dependency graph (modules, cycles, hotspots)', inputSchema: { type: 'object', properties: { cwd: { type: 'string' } } } },
      { name: 'get_health_score', description: 'Zero-token composite health score', inputSchema: { type: 'object', properties: { cwd: { type: 'string' } } } },
      { name: 'get_hot_zones', description: 'Highest-risk files by churn + complexity', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 } } } },
      { name: 'get_impact', description: 'Transitive impact of changing a file', inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] } },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const toolName = req.params.name;

    const resyncInfo = await maybeResyncOnStale(options);

    const observed = await withObservability<{ content: string; meta: Record<string, unknown> }>({ tool: toolName, args }, async (traceId) => {
      let content: string;
      switch (toolName) {
        case 'search_memory': { const r = await handleSearchMemory(args, { cwd: options.cwd, traceId }); content = r.content; break; }
        case 'get_dep_graph': { const r = await handleDepGraph(args, { cwd: options.cwd }); content = r.content; break; }
        case 'get_health_score': { const r = await handleHealthScore(args, { cwd: options.cwd }); content = r.content; break; }
        case 'get_hot_zones': { const r = await handleHotZones(args, { cwd: options.cwd }); content = r.content; break; }
        case 'get_impact': { const r = await handleImpact(args, { cwd: options.cwd }); content = r.content; break; }
        default: content = `Unknown tool: ${toolName}`;
      }
      const fullMeta = buildResponseMeta({ cwd: options.cwd, tool: toolName, traceId, estTokens: estimateTokens(content) });
      const meta = { ...fullMeta, syncRecommended: resyncInfo.confidence === 'stale' };
      return { content, meta: meta as unknown as Record<string, unknown> };
    });
    return {
      content: [{ type: 'text', text: observed.result.content }],
      _meta: observed.result.meta,
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      mimeType: r.mimeType,
      description: r.annotations.description,
      annotations: {
        audience: r.annotations.audience,
        priority: r.annotations.priority,
      },
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const resource = resources.find((r) => r.uri === uri || (r.uri.endsWith('}') && uri.startsWith(r.uri.slice(0, -1))));
    if (!resource) {
      return { contents: [{ uri, mimeType: 'text/plain', text: `Unknown resource: ${uri}` }] };
    }
    const { result } = await withObservability({ resource: uri, args: { uri } }, async (traceId) => {
      const args: ResourceArgs = { cwd: options.cwd, params: parseResourceParams(uri, resource) };
      const r = await resource.handler(args);
      const meta = buildResponseMeta({ cwd: options.cwd, resource: uri, traceId, estTokens: estimateTokens(r.contents[0]?.text ?? '') });
      return r.meta ? { contents: r.contents, meta: { ...meta, ...r.meta } } : { contents: r.contents, meta };
    });
    return { contents: result.contents, _meta: result.meta };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: prompts.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const prompt = prompts.find((p) => p.name === req.params.name);
    if (!prompt) {
      return { messages: [{ role: 'user', content: { type: 'text', text: `Unknown prompt: ${req.params.name}` } }] };
    }
    const args = (req.params.arguments ?? {}) as Record<string, string>;
    return await prompt.handler(args) as unknown as { messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  scopedLog.info('MCP server connected via stdio');

  process.on('SIGINT', () => {
    scopedLog.info('shutting down');
    if (internals.wikiRegenTimer) clearTimeout(internals.wikiRegenTimer);
    watcher?.stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    scopedLog.info('shutting down');
    if (internals.wikiRegenTimer) clearTimeout(internals.wikiRegenTimer);
    watcher?.stop();
    process.exit(0);
  });
}

export function scheduleWikiRegen(options: McpServerOptions): void {
  if (internals.wikiRegenTimer) clearTimeout(internals.wikiRegenTimer);
  const scopedLog = log.child('mcp.server');
  internals.wikiRegenTimer = setTimeout(async () => {
    try {
      const { runWiki } = await import('../cli/commands/wiki.js');
      const result = await runWiki({ cwd: options.cwd, tokenBudget: options.tokenBudget });
      scopedLog.info('wiki regenerated', { path: result.path, bytes: result.bytes });
      if (internals.notifyResource) {
        await internals.notifyResource('aion://project/context');
        await internals.notifyResource('aion://docs/architecture');
        await internals.notifyResource('aion://docs/test-coverage');
        await internals.notifyResource('aion://docs/dependencies');
        await internals.notifyResource('aion://docs/recent-changes');
      }
    } catch (err) {
      scopedLog.error('wiki regen failed', { error: String(err) });
    }
  }, 1000);
}

export async function maybeResyncOnStale(options: McpServerOptions): Promise<{ resynced: boolean; confidence: 'high' | 'medium' | 'stale' }> {
  if (!options.autoResync) {
    const store = readProjectStore(options.cwd);
    const indexedAt = store?.generatedAt ?? new Date(0).toISOString();
    const filesTotal = store?.stats.files ?? 0;
    const filesChangedSince = internals.watcher?.filesChanged() ?? 0;
    const confidence = computeConfidence(
      { indexedAt, filesChangedSince, filesTotal },
      options.freshness ?? DEFAULT_FRESHNESS,
    );
    return { resynced: false, confidence };
  }
  if (internals.resyncInFlight) {
    await internals.resyncInFlight;
    const store = readProjectStore(options.cwd);
    const indexedAt = store?.generatedAt ?? new Date(0).toISOString();
    const filesTotal = store?.stats.files ?? 0;
    const filesChangedSince = internals.watcher?.filesChanged() ?? 0;
    const confidence = computeConfidence(
      { indexedAt, filesChangedSince, filesTotal },
      options.freshness ?? DEFAULT_FRESHNESS,
    );
    return { resynced: true, confidence };
  }
  const store = readProjectStore(options.cwd);
  const indexedAt = store?.generatedAt ?? new Date(0).toISOString();
  const filesTotal = store?.stats.files ?? 0;
  const filesChangedSince = internals.watcher?.filesChanged() ?? 0;
  const confidence = computeConfidence(
    { indexedAt, filesChangedSince, filesTotal },
    options.freshness ?? DEFAULT_FRESHNESS,
  );
  if (confidence !== 'stale') {
    return { resynced: false, confidence };
  }
  internals.resyncInFlight = (async () => {
    try {
      await autoSyncIfNeeded({ cwd: options.cwd, config: options.freshness, force: true, quiet: true });
      log.child('mcp.server').info('auto-resync on stale completed');
      if (internals.notifyResource) {
        await internals.notifyResource('aion://project/context');
        await internals.notifyResource('aion://docs/architecture');
        await internals.notifyResource('aion://docs/recent-changes');
      }
    } catch (err) {
      log.child('mcp.server').error('auto-resync failed', { error: String(err) });
    } finally {
      internals.resyncInFlight = undefined;
    }
  })();
  await internals.resyncInFlight;
  const after = readProjectStore(options.cwd);
  const afterIndexedAt = after?.generatedAt ?? new Date(0).toISOString();
  const afterFilesTotal = after?.stats.files ?? 0;
  const afterFilesChangedSince = internals.watcher?.filesChanged() ?? 0;
  const afterConfidence = computeConfidence(
    { indexedAt: afterIndexedAt, filesChangedSince: afterFilesChangedSince, filesTotal: afterFilesTotal },
    options.freshness ?? DEFAULT_FRESHNESS,
  );
  return { resynced: true, confidence: afterConfidence };
}

function parseResourceParams(uri: string, resource: ResourceDescriptor): Record<string, string> {
  if (!resource.uri.endsWith('}')) return {};
  const prefix = resource.uri.slice(0, resource.uri.indexOf('{'));
  if (!uri.startsWith(prefix)) return {};
  const name = uri.slice(prefix.length);
  return { name };
}
