import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';

function getCurrentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname ?? '.', '../../package.json'), 'utf8')) as { version: string };
    return pkg.version;
  } catch { return '0.0.0'; }
}

const TOOLS = [
  {
    name: 'search_memory',
    description: 'Semantic search over project source code and knowledge base',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        topK: { type: 'number', description: 'Number of results (default: 5)' },
        cwd: { type: 'string', description: 'Project directory (default: current)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_dep_graph',
    description: 'Get dependency hotspots and cycles for a project',
    inputSchema: {
      type: 'object',
      properties: { cwd: { type: 'string', description: 'Project directory (default: current)' } },
    },
  },
  {
    name: 'get_health_score',
    description: 'Run zero-token composite health check (security, architecture, tests, churn)',
    inputSchema: {
      type: 'object',
      properties: { cwd: { type: 'string', description: 'Project directory (default: current)' } },
    },
  },
  {
    name: 'get_hot_zones',
    description: 'Get highest-risk files ranked by churn + complexity + dependency centrality',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: current)' },
        limit: { type: 'number', description: 'Max files to return (default: 10)' },
      },
    },
  },
  {
    name: 'get_impact',
    description: 'Show which files break if a given file is changed (transitive dependency analysis)',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Relative file path to analyze' },
        cwd: { type: 'string', description: 'Project directory (default: current)' },
      },
      required: ['file'],
    },
  },
] as const;

async function handleSearchMemory(args: Record<string, unknown>): Promise<string> {
  const cwd = String(args['cwd'] ?? process.cwd());
  const query = String(args['query']);
  const topK = Math.max(1, Math.min(50, Number(args['topK'] ?? 5) || 5));

  const { embedTextRemote, embedText } = await import('../infra/embeddings.js');
  const { createVectorStore } = await import('../infra/vector-store.js');
  const store = createVectorStore(cwd);

  if (store.size() === 0) return 'No vector index. Run `aion memory build` in the project first.';

  const remote = await embedTextRemote(query);
  const queryVec = remote ?? Array.from(embedText(query, 500));
  const results = await store.search(queryVec, topK);

  if (results.length === 0) return 'No results found.';

  return results.map((r, i) =>
    `[${i + 1}] ${r.payload['file']}:${r.payload['startLine']} — ${r.payload['name']}\n` +
    `    score: ${(r.score * 100).toFixed(1)}%\n` +
    `    ${String(r.payload['preview'] ?? '').split('\n').slice(0, 3).join('\n    ')}`,
  ).join('\n\n');
}

async function handleDepGraph(args: Record<string, unknown>): Promise<string> {
  const cwd = String(args['cwd'] ?? process.cwd());
  const { buildDepGraphAuto } = await import('../infra/dep-graph.js');
  const { formatDepReport } = await import('../infra/dep-graph.js');
  const graph = buildDepGraphAuto(cwd);
  return formatDepReport(graph);
}

async function handleHealthScore(args: Record<string, unknown>): Promise<string> {
  const cwd = String(args['cwd'] ?? process.cwd());
  const { computeHealthScore } = await import('../infra/health-score.js');
  const { measureCognitiveLoad } = await import('../infra/code-metrics.js');
  const { collectAuditStats } = await import('../core/pipelines/audit-file-scanner.js');
  const { buildDepGraphAuto } = await import('../infra/dep-graph.js');

  const stats = collectAuditStats(cwd, '.');
  const graph = buildDepGraphAuto(cwd);
  const { analyzeChurn } = await import('../infra/git-analysis.js');
  const churn = analyzeChurn(cwd);
  const cognitive = measureCognitiveLoad(cwd, 30);

  const score = computeHealthScore({
    totalFiles: stats.totalFiles,
    totalSymbols: 0,
    cycles: graph.cycles.length,
    hotspots: graph.hotspots.length,
    testFileRatio: stats.auditFiles.filter((f) => /\.(test|spec)\./.test(f)).length / Math.max(1, stats.auditFiles.length),
    churn,
    cognitiveLoad: cognitive,
  });

  return JSON.stringify({ total: score.total, grade: score.grade, topRisks: score.topRisks, dimensions: score.dimensions }, null, 2);
}

async function handleHotZones(args: Record<string, unknown>): Promise<string> {
  const cwd = String(args['cwd'] ?? process.cwd());
  const limit = Math.max(1, Math.min(100, Number(args['limit'] ?? 10) || 10));
  const { collectAuditStats, fetchGitChurn, prioritizeFiles } = await import('../core/pipelines/audit-file-scanner.js');
  const stats = collectAuditStats(cwd, '.');
  const top = prioritizeFiles(cwd, stats.auditFiles, limit);
  const churn = fetchGitChurn(cwd);
  return top.map((f, i) => `[${i + 1}] ${f} (churn: ${churn.get(f) ?? 0})`).join('\n');
}

async function handleImpact(args: Record<string, unknown>): Promise<string> {
  const cwd = String(args['cwd'] ?? process.cwd());
  const file = String(args['file']);
  const { buildDepGraphAuto } = await import('../infra/dep-graph.js');
  const graph = buildDepGraphAuto(cwd);

  // BFS over reverse edges
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

  if (visited.size === 0) return `No files directly import ${file}.`;
  const files = [...visited].sort();
  return `${files.length} file(s) transitively depend on ${file}:\n` + files.map((f) => `  - ${f}`).join('\n');
}

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: 'aion', version: getCurrentVersion() },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    let text: string;
    try {
      switch (req.params.name) {
        case 'search_memory':  text = await handleSearchMemory(args); break;
        case 'get_dep_graph':  text = await handleDepGraph(args); break;
        case 'get_health_score': text = await handleHealthScore(args); break;
        case 'get_hot_zones':  text = await handleHotZones(args); break;
        case 'get_impact':     text = await handleImpact(args); break;
        default: text = `Unknown tool: ${req.params.name}`;
      }
    } catch (err) {
      text = `Error: ${String(err)}`;
    }
    return { content: [{ type: 'text', text }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
