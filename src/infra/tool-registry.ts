export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const ToolRegistry = [
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

export function getToolDefinition(name: string) {
  const tool = ToolRegistry.find((t) => t.name === name);
  return tool || null;
}

export type ToolName = (typeof ToolRegistry)[number]['name'];
