import { readProjectStore } from '../infra/project-store.js';
import { renderProjectMarkdown } from '../cli/commands/wiki.js';
import { buildDepGraphAuto } from '../infra/dep-graph.js';
import { observabilitySummary, recentEntries } from './observability.js';
import { buildResponseMeta, computeConfidence } from './freshness.js';
import { FileWatcher } from './watcher.js';
import {
  DEFAULT_FRESHNESS,
  estimateTokens,
  type ResourceDescriptor,
  type ResourceResult,
} from './types.js';

export interface ResourceContext {
  cwd: string;
  traceId: string;
  watcher?: FileWatcher;
}

export function buildResourceList(ctx: ResourceContext): ResourceDescriptor[] {
  return [
    {
      uri: 'aion://project/context',
      name: 'Project context (PROJECT.md)',
      mimeType: 'text/markdown',
      annotations: {
        audience: 'both',
        priority: 0.9,
        freshness: 'sync',
        tokenCost: 1500,
        description: 'Token-budgeted digest of the project: overview, hotspots, modules, test coverage',
      },
      handler: async (args) => readProjectContext(args, ctx),
    },
    {
      uri: 'aion://docs/architecture',
      name: 'Architecture overview',
      mimeType: 'text/markdown',
      annotations: {
        audience: 'both',
        priority: 0.9,
        freshness: 'sync',
        tokenCost: 800,
        description: 'Modules, dependency graph, cycles, hotspots',
      },
      handler: async (args) => readArchitecture(args, ctx),
    },
    {
      uri: 'aion://docs/recent-changes',
      name: 'Recent file changes',
      mimeType: 'text/markdown',
      annotations: {
        audience: 'assistant',
        priority: 0.7,
        freshness: 'realtime',
        tokenCost: 300,
        description: 'Files changed since the last PIL sync (live)',
      },
      handler: async (args) => readRecentChanges(args, ctx),
    },
    {
      uri: 'aion://docs/security',
      name: 'Security findings',
      mimeType: 'text/markdown',
      annotations: {
        audience: 'user',
        priority: 0.3,
        freshness: 'sync',
        tokenCost: 1200,
        description: 'OWASP findings, secrets, vulnerable dependencies. User-only — not auto-included for assistants.',
      },
      handler: async (args) => readSecurity(args, ctx),
    },
    {
      uri: 'aion://docs/performance',
      name: 'Performance hotspots',
      mimeType: 'text/markdown',
      annotations: {
        audience: 'user',
        priority: 0.2,
        freshness: 'sync',
        tokenCost: 600,
        description: 'High complexity, hot paths, slow files',
      },
      handler: async (args) => readPerformance(args, ctx),
    },
    {
      uri: 'aion://docs/test-coverage',
      name: 'Test coverage gaps',
      mimeType: 'text/markdown',
      annotations: {
        audience: 'both',
        priority: 0.5,
        freshness: 'sync',
        tokenCost: 500,
        description: 'Source files without corresponding tests',
      },
      handler: async (args) => readTestCoverage(args, ctx),
    },
    {
      uri: 'aion://docs/dependencies',
      name: 'Dependencies and advisories',
      mimeType: 'text/markdown',
      annotations: {
        audience: 'both',
        priority: 0.5,
        freshness: 'sync',
        tokenCost: 700,
        description: 'Outdated dependencies, security advisories',
      },
      handler: async (args) => readDependencies(args, ctx),
    },
    {
      uri: 'aion://docs/modules/{name}',
      name: 'Module deep dive',
      mimeType: 'text/markdown',
      annotations: {
        audience: 'both',
        priority: 0.0,
        freshness: 'sync',
        tokenCost: 400,
        description: 'Per-module: symbols, imports, dependents, test coverage. Pass {name} as path param.',
      },
      handler: async (args) => readModuleDoc(args, ctx),
    },
    {
      uri: 'aion://health',
      name: 'Server health',
      mimeType: 'application/json',
      annotations: {
        audience: 'both',
        priority: 0.0,
        freshness: 'realtime',
        tokenCost: 100,
        description: 'PIL freshness, watcher status, provider reachability',
      },
      handler: async (args) => readHealth(args, ctx),
    },
    {
      uri: 'aion://observability/recent',
      name: 'Recent MCP requests',
      mimeType: 'application/json',
      annotations: {
        audience: 'user',
        priority: 0.0,
        freshness: 'realtime',
        tokenCost: 2000,
        description: 'Last 100 MCP requests from the ring buffer',
      },
      handler: async (args) => readObservabilityRecent(args, ctx),
    },
    {
      uri: 'aion://observability/summary',
      name: 'Observability summary',
      mimeType: 'application/json',
      annotations: {
        audience: 'user',
        priority: 0.0,
        freshness: 'realtime',
        tokenCost: 300,
        description: 'Aggregated stats: total calls, errors, p50/p95 latency, total tokens',
      },
      handler: async (args) => readObservabilitySummary(args, ctx),
    },
  ];
}

async function readProjectContext(args: { cwd: string; params: Record<string, string> }, ctx: ResourceContext): Promise<ResourceResult> {
  const store = readProjectStore(args.cwd);
  if (!store) {
    return {
      contents: [{ uri: 'aion://project/context', mimeType: 'text/markdown', text: '# No PIL found\n\nRun `aion sync` first.' }],
    };
  }
  const budget = parseInt(args.params['budget'] ?? '1500', 10) || 1500;
  const { md } = renderProjectMarkdown(store, budget);
  return {
    contents: [{ uri: 'aion://project/context', mimeType: 'text/markdown', text: md }],
    meta: buildResponseMeta({ cwd: args.cwd, resource: 'aion://project/context', traceId: ctx.traceId, estTokens: estimateTokens(md) }),
  };
}

async function readArchitecture(args: { cwd: string; params: Record<string, string> }, ctx: ResourceContext): Promise<ResourceResult> {
  const store = readProjectStore(args.cwd);
  if (!store) {
    return { contents: [{ uri: 'aion://docs/architecture', mimeType: 'text/markdown', text: 'No PIL. Run `aion sync`.' }] };
  }
  const graph = buildDepGraphAuto(args.cwd);
  const lines: string[] = ['# Architecture\n'];
  lines.push(`Generated: ${store.generatedAt}\n`);
  lines.push(`## Modules (${graph.nodes.size})`);
  const modules = [...graph.nodes.values()].slice(0, 25);
  for (const m of modules) {
    lines.push(`- \`${m.file}\` — ${m.loc} LOC · ${m.exports.length} exports · ${m.imports.length} imports`);
  }
  if (graph.cycles.length > 0) {
    lines.push(`\n## Circular dependencies (${graph.cycles.length})`);
    for (const c of graph.cycles.slice(0, 10)) lines.push(`- ${c.join(' → ')}`);
  }
  if (graph.hotspots.length > 0) {
    lines.push(`\n## Hotspots`);
    for (const h of graph.hotspots.slice(0, 10)) {
      lines.push(`- \`${h.file}\` — fan-in ${h.fanIn}, fan-out ${h.fanOut}`);
    }
  }
  const text = lines.join('\n');
  return {
    contents: [{ uri: 'aion://docs/architecture', mimeType: 'text/markdown', text }],
    meta: buildResponseMeta({ cwd: args.cwd, resource: 'aion://docs/architecture', traceId: ctx.traceId, estTokens: estimateTokens(text) }),
  };
}

async function readRecentChanges(args: { cwd: string; params: Record<string, string> }, ctx: ResourceContext): Promise<ResourceResult> {
  const changed = ctx.watcher?.filesChanged() ?? 0;
  const text = `# Recent changes\n\n${changed} file(s) changed since last sync.`;
  return {
    contents: [{ uri: 'aion://docs/recent-changes', mimeType: 'text/markdown', text }],
    meta: buildResponseMeta({ cwd: args.cwd, resource: 'aion://docs/recent-changes', traceId: ctx.traceId, estTokens: estimateTokens(text) }),
  };
}

async function readSecurity(_args: { cwd: string; params: Record<string, string> }, ctx: ResourceContext): Promise<ResourceResult> {
  const text = '# Security findings\n\nThis resource is user-only. Use `aion scan security` for full results.';
  return {
    contents: [{ uri: 'aion://docs/security', mimeType: 'text/markdown', text }],
    meta: buildResponseMeta({ cwd: _args.cwd, resource: 'aion://docs/security', traceId: ctx.traceId, estTokens: estimateTokens(text) }),
  };
}

async function readPerformance(_args: { cwd: string; params: Record<string, string> }, ctx: ResourceContext): Promise<ResourceResult> {
  const text = '# Performance\n\nUse `aion scan cognitive-load` and `aion scan api-map` for detailed performance analysis.';
  return {
    contents: [{ uri: 'aion://docs/performance', mimeType: 'text/markdown', text }],
    meta: buildResponseMeta({ cwd: _args.cwd, resource: 'aion://docs/performance', traceId: ctx.traceId, estTokens: estimateTokens(text) }),
  };
}

async function readTestCoverage(args: { cwd: string; params: Record<string, string> }, ctx: ResourceContext): Promise<ResourceResult> {
  const store = readProjectStore(args.cwd);
  if (!store) {
    return { contents: [{ uri: 'aion://docs/test-coverage', mimeType: 'text/markdown', text: 'No PIL. Run `aion sync`.' }] };
  }
  const sources = store.files.filter((f) => !f.isTest);
  const testedSources = new Set(store.tests.map((t) => t.source));
  const untested = sources.filter((s) => !testedSources.has(s.path));
  const lines = [
    '# Test coverage\n',
    `Total source files: ${sources.length}`,
    `Linked to tests: ${testedSources.size}`,
    `Untested: ${untested.length}`,
    '',
    '## Untested files',
    ...untested.slice(0, 30).map((f) => `- \`${f.path}\` (${f.loc} LOC)`),
  ];
  const text = lines.join('\n');
  return {
    contents: [{ uri: 'aion://docs/test-coverage', mimeType: 'text/markdown', text }],
    meta: buildResponseMeta({ cwd: args.cwd, resource: 'aion://docs/test-coverage', traceId: ctx.traceId, estTokens: estimateTokens(text) }),
  };
}

async function readDependencies(_args: { cwd: string; params: Record<string, string> }, ctx: ResourceContext): Promise<ResourceResult> {
  const text = '# Dependencies\n\nUse `aion scan sbom --unpinned-only` for full SBOM with outdated deps.';
  return {
    contents: [{ uri: 'aion://docs/dependencies', mimeType: 'text/markdown', text }],
    meta: buildResponseMeta({ cwd: _args.cwd, resource: 'aion://docs/dependencies', traceId: ctx.traceId, estTokens: estimateTokens(text) }),
  };
}

async function readModuleDoc(args: { cwd: string; params: Record<string, string> }, ctx: ResourceContext): Promise<ResourceResult> {
  const name = args.params['name'] ?? '';
  if (!name) {
    return { contents: [{ uri: `aion://docs/modules/`, mimeType: 'text/markdown', text: 'Missing {name} parameter.' }] };
  }
  const store = readProjectStore(args.cwd);
  if (!store) {
    return { contents: [{ uri: `aion://docs/modules/${name}`, mimeType: 'text/markdown', text: 'No PIL. Run `aion sync`.' }] };
  }
  const node = store.deps.nodes.find((n) => n.file === name);
  const symbols = store.symbols.filter((s) => s.file === name);
  const lines = [
    `# Module: ${name}`,
    '',
    node ? `Lines of code: ${node.loc}` : 'Module not in dependency graph.',
    '',
    '## Exports',
    ...(node?.exports ?? []).map((e) => `- ${e}`),
    '',
    '## Imports',
    ...(node?.imports ?? []).map((i) => `- \`${i}\``),
    '',
    '## Symbols',
    ...symbols.slice(0, 20).map((s) => `- \`${s.name}\` (${s.kind}) at line ${s.line}`),
  ];
  const text = lines.join('\n');
  return {
    contents: [{ uri: `aion://docs/modules/${name}`, mimeType: 'text/markdown', text }],
    meta: buildResponseMeta({ cwd: args.cwd, resource: `aion://docs/modules/${name}`, traceId: ctx.traceId, estTokens: estimateTokens(text) }),
  };
}

async function readHealth(args: { cwd: string; params: Record<string, string> }, ctx: ResourceContext): Promise<ResourceResult> {
  const store = readProjectStore(args.cwd);
  const indexedAt = store?.generatedAt ?? null;
  const filesTotal = store?.stats.files ?? 0;
  const filesChangedSince = ctx.watcher?.filesChanged() ?? 0;
  const confidence = indexedAt
    ? computeConfidence({ indexedAt, filesChangedSince, filesTotal }, DEFAULT_FRESHNESS)
    : 'stale';
  const health = {
    pilExists: !!store,
    pilVersion: store?.schemaVersion ?? null,
    indexedAt,
    filesTotal,
    filesChangedSince,
    confidence,
    watcherActive: ctx.watcher?.stats().active ?? false,
    watchedRoots: ctx.watcher?.stats().watchedRoots ?? [],
    summary: observabilitySummary(),
  };
  const text = JSON.stringify(health, null, 2);
  return {
    contents: [{ uri: 'aion://health', mimeType: 'application/json', text }],
    meta: buildResponseMeta({ cwd: args.cwd, resource: 'aion://health', traceId: ctx.traceId, estTokens: estimateTokens(text) }),
  };
}

async function readObservabilityRecent(args: { cwd: string; params: Record<string, string> }, ctx: ResourceContext): Promise<ResourceResult> {
  const limit = parseInt(args.params['limit'] ?? '50', 10) || 50;
  const entries = recentEntries(limit);
  const text = JSON.stringify(entries, null, 2);
  return {
    contents: [{ uri: 'aion://observability/recent', mimeType: 'application/json', text }],
    meta: buildResponseMeta({ cwd: args.cwd, resource: 'aion://observability/recent', traceId: ctx.traceId, estTokens: estimateTokens(text) }),
  };
}

async function readObservabilitySummary(args: { cwd: string; params: Record<string, string> }, ctx: ResourceContext): Promise<ResourceResult> {
  const summary = observabilitySummary();
  const text = JSON.stringify(summary, null, 2);
  return {
    contents: [{ uri: 'aion://observability/summary', mimeType: 'application/json', text }],
    meta: buildResponseMeta({ cwd: args.cwd, resource: 'aion://observability/summary', traceId: ctx.traceId, estTokens: estimateTokens(text) }),
  };
}
