import chalk from 'chalk';
import type { MenuItem } from './tui.js';

export type MenuAction =
  | 'local-check'
  | 'seo'
  | 'network-scan'
  | 'app-security'
  | 'bugs'
  | 'security'
  | 'perf'
  | 'copilot'
  | 'fix'
  | 'analyze'
  | 'assistant'
  | 'chat-qa'
  | 'report'
  | 'links'
  | 'mcp-install'
  | 'mcp-doctor'
  | 'change-provider'
  | 'doctor'
  | 'providers'
  | 'sep'
  | 'quit';

export function buildMainItems(provider: string): Array<MenuItem<MenuAction>> {
  return [
    { label: 'Diagnostics', header: true, value: 'sep' },
    { label: '📊 Automatic diagnostics', hint: 'zero token · health + secrets + env + SBOM', description: 'Runs health score, secret scan, env-audit, and SBOM — all locally with zero token cost. Shows a risk summary and links to the HTML report.', value: 'local-check', key: 'd' },
    { label: '🌐 SEO & Crawlers',        hint: 'zero token · Next.js routes, sitemap, robots', description: 'Crawls your project for Next.js pages, sitemap.xml, robots.txt, and meta tags. No API calls — purely local analysis.', value: 'seo', key: 's' },
    { label: '🔒 Network & API Security', hint: 'zero token · HTTPS, CORS, cookies, IDs, keys', description: 'Scans for insecure HTTP calls, CORS wildcard, hardcoded API keys, insecure cookies, sequential IDs (IDOR), and missing security headers. Zero token — static analysis only.', value: 'network-scan', key: 'n' },
    { label: '🛡️  App Security (OWASP)',   hint: 'zero token · XSS, JWT, proto pollution, injection', description: 'OWASP Top 10 static scan: XSS sinks, JWT weaknesses, prototype pollution, mass assignment, path traversal, and error leakage. Zero token — pure static analysis.', value: 'app-security', key: 'y' },
    { label: '', value: 'sep', separator: true },
    { label: 'Audit', header: true, value: 'sep' },
    { label: '🐛 Bugs & Quality',        hint: 'zero-token local scan or normal AI',          description: 'Choose Local (zero token) or AI mode. Scans for logic bugs, null dereferences, error-handling gaps, and test coverage holes.', value: 'bugs',     key: 'b' },
    { label: '🔐 Security',              hint: 'zero-token local scan or normal AI',          description: 'Choose Local (zero token) or AI mode. Reviews for injection, auth bypass, secrets exposure, dependency CVEs, and OWASP Top 10.', value: 'security', key: 'e' },
    { label: '⚡ Performance & Infra',   hint: 'zero-token local scan or normal AI',          description: 'Choose Local (zero token) or AI mode. Finds bottlenecks, missing timeouts, N+1 queries, and observability gaps.', value: 'perf',     key: 'p' },
    { label: '🛡️  Copilot Safe',          hint: 'zero token · pre-commit safety gate',          description: 'Pre-commit safety check. Validates staged changes for obvious regressions before you commit. Zero token — instant feedback.', value: 'copilot',  key: 'g' },
    { label: '', value: 'sep', separator: true },
    { label: 'AI Tools', header: true, value: 'sep' },
    { label: '🔧 Fix file',              hint: 'uses AI · runs fix pipeline on a file',       description: 'Pick a file and let the AI apply targeted fixes. Uses the full fix pipeline: analyze → patch → verify.', value: 'fix',       key: 'f' },
    { label: '🔍 Analyze problem',       hint: 'uses AI · focused problem description',       description: 'Describe a specific bug or architectural question. The AI focuses its full context window on your problem statement.', value: 'analyze',  key: 'a' },
    { label: '🤖 Direct assistant',      hint: 'uses AI when the intent requires it',         description: 'General-purpose assistant. Routes to local tools when possible, falls back to AI when needed.', value: 'assistant', key: 'i' },
    { label: '💬 Code chat',             hint: 'uses AI · repository-aware questions',        description: 'Chat with the AI about your repository. Uses the repo index for context — ask about architecture, patterns, or specific files.', value: 'chat-qa',  key: 'c' },
    { label: '📋 View report',           hint: 'zero token · opens the unified main report',  description: 'Open the latest unified audit report. Shows the HTML visual, markdown digest, and recommended next actions.', value: 'report',    key: 'r' },
    { label: '', value: 'sep', separator: true },
    { label: 'Links', header: true, value: 'sep' },
    { label: '🔗 Project links',          hint: 'GitHub · LinkedIn · email',                  description: 'Shows the GitHub repository, Bruno Inácio LinkedIn profile, and contact email.', value: 'links', key: 'l' },
    { label: '', value: 'sep', separator: true },
    { label: 'MCP', header: true, value: 'sep' },
    { label: '🔌 MCP install',    hint: 'one-time · register in Cursor/Claude/Codex',   description: 'Install aion as MCP server in your AI client. One-time setup that connects Cursor, Claude Desktop, Codex CLI, or OpenCode to aion\'s tools and resources.', value: 'mcp-install', key: 'm' },
    { label: '🩺 MCP doctor',     hint: 'zero token · verify MCP integration',        description: 'Check MCP integration health across all clients. Verifies that .cursor/mcp.json, ~/.claude/mcp.json, ~/.codex/config.toml, and opencode.json are correctly configured.', value: 'mcp-doctor', key: 'd' },
    { label: '', value: 'sep', separator: true },
    { label: 'System', header: true, value: 'sep' },
    { label: '🩺 Doctor',     hint: 'zero token · check all system components', description: 'Runs a full system health check: API keys, index freshness, provider connectivity, and tool availability.', value: 'doctor',    key: 'o' },
    { label: '🔌 Providers',  hint: 'zero token · show AI provider status',     description: 'Lists all configured AI providers, shows which is active, and reports API key status for each.', value: 'providers' },
    { label: '', value: 'sep', separator: true },
    { label: `⚙️  Provider: ${chalk.cyan(provider)}`, hint: 'change AI provider', value: 'change-provider' },
    { label: '  Quit', value: 'quit', key: 'q' },
  ];
}

export const MAIN_ITEMS: Array<MenuItem<MenuAction>> = buildMainItems('claude');
