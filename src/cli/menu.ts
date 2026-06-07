import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { selectOne, selectMany, printHeader } from './tui.js';
import type { MenuItem } from './tui.js';
import type { ScanDomain } from '../prompts/scanner.js';

// ── Data ──────────────────────────────────────────────────────────────────────

export const ALL_DOMAINS: Array<MenuItem<ScanDomain>> = [
  { label: 'security',       hint: 'pentester finding attack vectors',                     value: 'security' },
  { label: 'bugs',           hint: 'QA hunting logic failures & null dereferences',        value: 'bugs' },
  { label: 'redundancy',     hint: 'architect eliminating dead/duplicate code',            value: 'redundancy' },
  { label: 'error-handling', hint: 'SRE finding silent failure points',                    value: 'error-handling' },
  { label: 'architecture',   hint: 'tech lead evaluating coupling & debt',                 value: 'architecture' },
  { label: 'testing',        hint: 'QA engineer mapping test coverage gaps',               value: 'testing' },
  { label: 'performance',    hint: 'platform engineer hunting bottlenecks',                value: 'performance' },
  { label: 'infrastructure', hint: 'DevOps reviewing K8s & containers',                   value: 'infrastructure' },
  { label: 'observability',  hint: 'SRE checking logging, tracing & metrics',             value: 'observability' },
  { label: 'resilience',     hint: 'reliability eng: timeouts, retries, circuit breakers', value: 'resilience' },
  { label: 'data',           hint: 'DBA finding N+1 queries & missing indexes',           value: 'data' },
  { label: 'dependencies',   hint: 'security eng on supply chain & CVEs',                 value: 'dependencies' },
  { label: 'compliance',     hint: 'DPO verifying LGPD/GDPR compliance',                  value: 'compliance' },
  { label: 'multitenancy',   hint: 'architect verifying tenant isolation',                 value: 'multitenancy' },
  { label: 'prompt-audit',   hint: 'AI eng auditing LLM prompts & injection',             value: 'prompt-audit' },
];

export const PRESETS: Array<MenuItem<string>> = [
  { label: '🔐 Security',  hint: 'security, compliance, dependencies, multitenancy',               value: 'security' },
  { label: '🤖 AI/LLM',   hint: 'prompt-audit, security, resilience, observability, data',        value: 'ai' },
  { label: '⚙️  Backend',  hint: 'security, data, error-handling, resilience, performance',        value: 'backend' },
  { label: '🛠️  DevOps',   hint: 'infrastructure, observability, resilience, dependencies',        value: 'devops' },
  { label: '✨ Quality',   hint: 'bugs, architecture, testing, redundancy, error-handling',        value: 'quality' },
  { label: '🏢 SaaS',     hint: 'multitenancy, compliance, security, resilience, observability',  value: 'saas' },
  { label: '🏦 FinTech',  hint: 'compliance, security, data, multitenancy, error-handling',       value: 'fintech' },
  { label: '🌍 Full',     hint: 'all 15 personas (requires --force-full)',                        value: 'full' },
  { label: '📝 Custom…',  hint: 'select individual personas with Space',                          value: 'custom' },
  { label: '← Back',     value: 'back' },
];

export const BUDGETS: Array<MenuItem<string>> = [
  { label: 'low',    hint: 'fast & cheap   · est. $0.10–0.50', value: 'low' },
  { label: 'normal', hint: 'balanced       · est. $0.50–2.00', value: 'normal' },
  { label: 'deep',   hint: 'thorough       · est. $2.00–5.00', value: 'deep' },
];

// ── Human-first main menu ─────────────────────────────────────────────────────

export const MAIN_ITEMS: Array<MenuItem<string>> = [
  { label: 'Preparar / configurar projeto', hint: 'wizard inicial: setup, índices e RAG opcional', value: 'setup' },
  { label: 'Ver estado do projeto',       hint: 'health, scans rápidos, árvore e docs',        value: 'status' },
  { label: 'Encontrar problemas',         hint: 'scan local, auditoria, padrões e relatórios', value: 'problems' },
  { label: 'Buscar e entender código',    hint: 'grafo, busca, impacto e memória/RAG',         value: 'explore' },
  { label: 'Corrigir ou revisar com IA',  hint: 'fix, analyze, review, explain e chat',        value: 'ai-help' },
  { label: 'Publicar / operar',           hint: 'CI + deploy assistido, healthcheck e init',   value: 'publish' },
  { label: 'Avançado',                    hint: 'churn, diff, cloud, MCP, eval e trace',       value: 'advanced' },
  { label: '', value: 'sep', separator: true },
  { label: '❯ Natural language', hint: 'type a request in any language', value: 'nl' },
  { label: '  Quit', value: 'quit' },
];

export type MenuActionDisposition = 'keep' | 'fix' | 'hide' | 'remove';
export type MenuActionCost = 'zero-token' | 'local-side-effect' | 'ai' | 'external-service' | 'long-running';

export interface MenuActionAuditEntry {
  action: string;
  command?: string[];
  submenu?: string;
  cost: MenuActionCost;
  recommendation: MenuActionDisposition;
  note: string;
}

export const DIRECT_COMMANDS: Record<string, string[]> = {
  setup:    ['setup'],
  health:   ['health'],
  churn:    ['churn'],
  tree:     ['tree', '--hotspots'],
  diff:     ['diff'],
  graph:    ['graph'],
  patterns: ['patterns'],
  report:   ['report'],
  chat:     ['chat'],
  assist:   ['assist'],
  init:     ['init'],
  trace:    ['trace'],
};

export const MENU_ACTION_AUDIT: MenuActionAuditEntry[] = [
  { action: 'setup', command: DIRECT_COMMANDS.setup, cost: 'local-side-effect', recommendation: 'keep', note: 'Onboarding wizard for config/index setup.' },
  { action: 'status', submenu: 'status', cost: 'zero-token', recommendation: 'keep', note: 'Human-friendly project status submenu.' },
  { action: 'problems', submenu: 'problems', cost: 'ai', recommendation: 'keep', note: 'Problem finding submenu with local and AI options.' },
  { action: 'explore', submenu: 'explore', cost: 'local-side-effect', recommendation: 'keep', note: 'Code understanding submenu with graph/search/memory.' },
  { action: 'ai-help', submenu: 'ai-help', cost: 'ai', recommendation: 'keep', note: 'AI fix/analyze/review/explain/chat submenu.' },
  { action: 'publish', submenu: 'publish', cost: 'local-side-effect', recommendation: 'keep', note: 'CI and deploy assist submenu.' },
  { action: 'advanced', submenu: 'advanced', cost: 'external-service', recommendation: 'keep', note: 'Advanced tools kept off the main path.' },
  { action: 'health', command: DIRECT_COMMANDS.health, cost: 'zero-token', recommendation: 'keep', note: 'Local health score smoke test.' },
  { action: 'scan', submenu: 'scan', cost: 'zero-token', recommendation: 'keep', note: 'Local static scans; each scan type is testable.' },
  { action: 'churn', command: DIRECT_COMMANDS.churn, cost: 'zero-token', recommendation: 'keep', note: 'Uses git history only.' },
  { action: 'tree', command: DIRECT_COMMANDS.tree, cost: 'zero-token', recommendation: 'keep', note: 'Uses repository index and audit history.' },
  { action: 'diff', command: DIRECT_COMMANDS.diff, cost: 'zero-token', recommendation: 'keep', note: 'Requires previous audit reports for useful output.' },
  { action: 'graph', command: DIRECT_COMMANDS.graph, cost: 'local-side-effect', recommendation: 'keep', note: 'Writes graph artifacts under .ai-runtime.' },
  { action: 'search', submenu: 'prompt', cost: 'zero-token', recommendation: 'keep', note: 'Prompts for query and runs local repo search.' },
  { action: 'impact', submenu: 'prompt', cost: 'zero-token', recommendation: 'keep', note: 'Prompts for a file before running impact-local.' },
  { action: 'memory', submenu: 'memory', cost: 'local-side-effect', recommendation: 'keep', note: 'Build/search/deps may write .ai-memory and vector files.' },
  { action: 'audit', submenu: 'audit', cost: 'ai', recommendation: 'keep', note: 'Budget and full-audit guardrails are handled by audit command.' },
  { action: 'patterns', command: DIRECT_COMMANDS.patterns, cost: 'zero-token', recommendation: 'keep', note: 'Local pattern detection.' },
  { action: 'report', command: DIRECT_COMMANDS.report, cost: 'local-side-effect', recommendation: 'keep', note: 'Generates local reports.' },
  { action: 'fix', submenu: 'prompt', cost: 'ai', recommendation: 'keep', note: 'Prompts before AI fix pipeline.' },
  { action: 'analyze', submenu: 'prompt', cost: 'ai', recommendation: 'keep', note: 'Prompts before AI analysis pipeline.' },
  { action: 'review', submenu: 'prompt', cost: 'ai', recommendation: 'keep', note: 'Prompts before AI review pipeline.' },
  { action: 'explain', submenu: 'explain', cost: 'ai', recommendation: 'keep', note: 'File explain uses provider; onboard is AI-powered.' },
  { action: 'chat', command: DIRECT_COMMANDS.chat, cost: 'ai', recommendation: 'keep', note: 'Interactive provider-backed chat.' },
  { action: 'docs', submenu: 'docs', cost: 'ai', recommendation: 'keep', note: 'Analyze is local; generate is AI-powered.' },
  { action: 'assist', command: DIRECT_COMMANDS.assist, cost: 'local-side-effect', recommendation: 'keep', note: 'Guided CI/deploy setup defaults to dry-run.' },
  { action: 'cloud', submenu: 'cloud', cost: 'external-service', recommendation: 'keep', note: 'Read-only cloud CLIs and credentials.' },
  { action: 'mcp', submenu: 'mcp', cost: 'long-running', recommendation: 'hide', note: 'Serve/register are advanced setup actions.' },
  { action: 'eval', submenu: 'eval', cost: 'ai', recommendation: 'keep', note: 'Scaffold/local retrieval are cheap; LLM rerank is explicit.' },
  { action: 'trace', command: DIRECT_COMMANDS.trace, cost: 'zero-token', recommendation: 'keep', note: 'Reads local trace history.' },
  { action: 'init', command: DIRECT_COMMANDS.init, cost: 'local-side-effect', recommendation: 'keep', note: 'Creates project config files.' },
  { action: 'nl', submenu: 'interactive', cost: 'ai', recommendation: 'keep', note: 'Natural language mode may route to AI pipelines.' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetTty(): void {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode!(false);
    process.stdout.write('\x1b[?25h'); // show cursor
  } catch { /* ok */ }
}

function drainStdin(): void {
  // Discard any bytes the child left buffered in stdin
  try {
    process.stdin.read();
  } catch { /* ok */ }
}

function run(args: string[]): void {
  resetTty();
  const result = spawnSync(process.execPath, [process.argv[1]!, ...args], {
    stdio: 'inherit', env: process.env,
  });
  resetTty();
  drainStdin();
  if (result.error) console.error(chalk.red(result.error.message));
}

async function pressEnter(): Promise<void> {
  resetTty();
  drainStdin();
  return new Promise<void>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    process.stdout.write(chalk.dim('\n  Press Enter to return to menu...'));
    const onData = () => {
      rl.close();
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve();
    };
    process.stdin.once('data', onData);
  });
}

async function promptLine(question: string): Promise<string> {
  resetTty();
  drainStdin();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(chalk.cyan(`  ${question}: `), (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

// ── Submenus ──────────────────────────────────────────────────────────────────

async function runAuditMenu(cwd: string): Promise<void> {
  const preset = await selectOne('Select persona preset', PRESETS, 'Each preset is a team of specialized AI personas');
  if (!preset || preset === 'back') return;

  let domainArgs: string[];
  if (preset === 'custom') {
    const chosen = await selectMany('Select personas', ALL_DOMAINS, 'Space to toggle, Enter to confirm');
    if (!chosen || chosen.length === 0) return;
    domainArgs = ['--domains', chosen.join(',')];
  } else {
    domainArgs = ['--preset', preset];
  }

  const budget = await selectOne('Select budget', BUDGETS);
  if (!budget) return;

  console.log(chalk.bold.cyan('\nStarting audit…\n'));
  run(['--cwd', cwd, 'audit', '.', ...domainArgs, '--budget', budget]);
  await pressEnter();
}

async function runScanMenu(cwd: string): Promise<void> {
  const item = await selectOne('Select scan type', [
    { label: 'api-map',        hint: 'endpoints with auth/rate-limit status',       value: 'api-map' },
    { label: 'env-audit',      hint: 'env vars documented vs undocumented',         value: 'env-audit' },
    { label: 'cognitive-load', hint: 'nesting, magic numbers, long functions',      value: 'cognitive-load' },
    { label: 'secrets',        hint: 'hardcoded credentials in source files',       value: 'secrets' },
    { label: 'sbom',           hint: 'software bill of materials + unpinned deps',  value: 'sbom' },
    { label: '← Back',        value: 'back' },
  ]);
  if (!item || item === 'back') return;
  run(['--cwd', cwd, 'scan', item]);
  await pressEnter();
}

async function runMemoryMenu(cwd: string): Promise<void> {
  const action = await selectOne('Memory action', [
    { label: 'build index',  hint: 'index source + .ai-memory/ into vector store', value: 'build' },
    { label: 'search',       hint: 'semantic search over indexed code',             value: 'search' },
    { label: 'deps',         hint: 'dependency report saved to .ai-memory/',       value: 'deps' },
    { label: '← Back',      value: 'back' },
  ]);
  if (!action || action === 'back') return;

  if (action === 'search') {
    const q = await promptLine('Search query');
    if (!q) return;
    run(['--cwd', cwd, 'memory', 'search', q]);
    await pressEnter();
    return;
  }
  run(['--cwd', cwd, 'memory', action]);
  await pressEnter();
}

async function runExplainMenu(cwd: string): Promise<void> {
  const mode = await selectOne('Select mode', [
    { label: 'explain <file>', hint: 'what a file does and why it matters', value: 'explain' },
    { label: 'onboard',        hint: 'developer onboarding guide',          value: 'onboard' },
    { label: '← Back',        value: 'back' },
  ]);
  if (!mode || mode === 'back') return;

  if (mode === 'onboard') {
    run(['--cwd', cwd, 'onboard']);
    await pressEnter();
    return;
  }

  const file = await promptLine('File path');
  if (!file) return;
  run(['--cwd', cwd, mode, file]);
  await pressEnter();
}

async function runDocsMenu(cwd: string): Promise<void> {
  const action = await selectOne('Documentation', [
    { label: 'analyze',     hint: 'zero-token: find missing docs, sections, docstrings', value: 'analyze' },
    { label: 'generate',    hint: 'AI-powered: write missing README, docstrings, etc.',  value: 'generate' },
    { label: '← Back',     value: 'back' },
  ]);
  if (!action || action === 'back') return;
  run(['--cwd', cwd, 'docs', action]);
  await pressEnter();
}

async function runCloudMenu(cwd: string): Promise<void> {
  const action = await selectOne('Cloud (read-only)', [
    { label: 'status',   hint: 'which providers are detected + authenticated',    value: 'status' },
    { label: 'analyze',  hint: 'read cloud resources + identify project gaps',    value: 'analyze' },
    { label: 'gaps',     hint: 'show only gap report (no resource listing)',      value: 'gaps' },
    { label: '← Back',  value: 'back' },
  ]);
  if (!action || action === 'back') return;
  run(['--cwd', cwd, 'cloud', action]);
  await pressEnter();
}

async function runMcpMenu(cwd: string): Promise<void> {
  const action = await selectOne('MCP Server', [
    { label: 'list tools',  hint: 'show tools exposed to Claude Desktop',          value: 'list-tools' },
    { label: 'serve',       hint: 'start MCP server via stdio',                    value: 'serve' },
    { label: 'register',    hint: 'register in ~/.claude/mcp.json',                value: 'register' },
    { label: '← Back',     value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'register') { run(['--cwd', cwd, 'mcp', 'serve', '--register']); await pressEnter(); return; }
  run(['--cwd', cwd, 'mcp', action]);
  await pressEnter();
}

async function runEvalMenu(cwd: string): Promise<void> {
  const action = await selectOne('Evaluation', [
    { label: 'scaffold golden set', hint: 'create example .ai-memory/eval/retrieval.json', value: 'scaffold' },
    { label: 'eval retrieval',      hint: 'measure recall@3/5 and MRR',                    value: 'retrieval' },
    { label: 'eval + rerank (llm)', hint: 'same but with LLM re-ranking pass',             value: 'retrieval-llm' },
    { label: '← Back',             value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'scaffold') { run(['--cwd', cwd, 'eval', 'retrieval', '--scaffold']); await pressEnter(); return; }
  if (action === 'retrieval-llm') { run(['--cwd', cwd, 'eval', 'retrieval', '--rerank', 'llm']); await pressEnter(); return; }
  run(['--cwd', cwd, 'eval', 'retrieval']);
  await pressEnter();
}

async function runStatusMenu(cwd: string): Promise<void> {
  const action = await selectOne('Ver estado do projeto', [
    { label: 'Health score',       hint: 'resumo local 0-100',                       value: 'health' },
    { label: 'Scan secrets',       hint: 'zero-token: credenciais hardcoded',        value: 'scan-secrets' },
    { label: 'Tree hotspots',      hint: 'árvore do projeto com pontos relevantes',  value: 'tree' },
    { label: 'Docs analyze',       hint: 'lacunas de documentação',                  value: 'docs-analyze' },
    { label: '← Back',             value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'scan-secrets') { run(['--cwd', cwd, 'scan', 'secrets']); await pressEnter(); return; }
  if (action === 'docs-analyze') { run(['--cwd', cwd, 'docs', 'analyze']); await pressEnter(); return; }
  run(['--cwd', cwd, ...(DIRECT_COMMANDS[action] ?? [action])]);
  await pressEnter();
}

async function runProblemsMenu(cwd: string): Promise<void> {
  const action = await selectOne('Encontrar problemas', [
    { label: 'Scan local',        hint: 'secrets, env, api-map, sbom',        value: 'scan' },
    { label: 'Audit rápida', hint: 'usa defaults do setup (baixo custo)', value: 'audit-quick' },
    { label: 'Patterns',          hint: 'padrões arquiteturais locais',       value: 'patterns' },
    { label: 'Report',            hint: 'relatório HTML/Markdown local',      value: 'report' },
    { label: '← Back',            value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'scan') { await runScanMenu(cwd); return; }
  if (action === 'audit-quick') { run(['--cwd', cwd, 'audit', '.']); await pressEnter(); return; }
  run(['--cwd', cwd, ...(DIRECT_COMMANDS[action] ?? [action])]);
  await pressEnter();
}

async function runExploreMenu(cwd: string): Promise<void> {
  const action = await selectOne('Buscar e entender código', [
    { label: 'Graph',        hint: 'mapa interativo de dependências', value: 'graph' },
    { label: 'Search',       hint: 'busca no índice/repo',            value: 'search' },
    { label: 'Impact',       hint: 'o que quebra se arquivo mudar',   value: 'impact' },
    { label: 'Memory / RAG', hint: 'build/search/deps do índice',     value: 'memory' },
    { label: '← Back',       value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'memory') { await runMemoryMenu(cwd); return; }
  if (action === 'search') {
    const q = await promptLine('Search query');
    if (q) { run(['--cwd', cwd, 'search', q]); await pressEnter(); }
    return;
  }
  if (action === 'impact') {
    const file = await promptLine('File path for impact analysis');
    if (file) { run(['--cwd', cwd, 'impact-local', file, '--rebuild']); await pressEnter(); }
    return;
  }
  run(['--cwd', cwd, ...(DIRECT_COMMANDS[action] ?? [action])]);
  await pressEnter();
}

async function runAiHelpMenu(cwd: string): Promise<void> {
  const action = await selectOne('Corrigir ou revisar com IA', [
    { label: 'Fix',     hint: 'corrigir arquivo/bug com IA',      value: 'fix' },
    { label: 'Analyze', hint: 'investigar bug ou comportamento',  value: 'analyze' },
    { label: 'Review',  hint: 'revisar arquivo ou diff',          value: 'review' },
    { label: 'Explain', hint: 'explicar arquivo/onboarding',      value: 'explain' },
    { label: 'Chat',    hint: 'Q&A interativo sobre o repo',      value: 'chat' },
    { label: '← Back',  value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'explain') { await runExplainMenu(cwd); return; }
  if (action === 'chat') { run(['--cwd', cwd, 'chat']); await pressEnter(); return; }
  if (action === 'fix') {
    const file = await promptLine('File to fix (relative path)');
    if (file) { run(['--cwd', cwd, 'fix', file]); await pressEnter(); }
    return;
  }
  if (action === 'analyze') {
    const target = await promptLine('Describe the bug or issue');
    if (target) { run(['--cwd', cwd, 'analyze', target]); await pressEnter(); }
    return;
  }
  if (action === 'review') {
    const target = await promptLine('File path or diff to review');
    if (target) { run(['--cwd', cwd, 'review', target]); await pressEnter(); }
  }
}

async function runPublishMenu(cwd: string): Promise<void> {
  const action = await selectOne('Publicar / operar', [
    { label: 'CI + Deploy assistido', hint: 'plano seguro em dry-run',              value: 'assist' },
    { label: 'Configurar CI',         hint: 'GitHub Actions com testes e scans',    value: 'ci-assist' },
    { label: 'Plano de deploy',       hint: 'gera .ai-runtime/assist/deploy-plan',  value: 'deploy-plan' },
    { label: 'Deploy assistido',      hint: 'gera workflows, Nginx e healthcheck',  value: 'deploy-assist' },
    { label: 'Aplicar plano',         hint: 'pergunta caminho do plano, dry-run',   value: 'deploy-apply' },
    { label: 'Testar healthcheck',    hint: 'curl em URL informada',                value: 'deploy-check' },
    { label: 'Init projeto',          hint: '.aionrc.json + .aionignore',           value: 'init' },
    { label: '← Back',                value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'ci-assist') { run(['--cwd', cwd, 'ci', 'assist']); await pressEnter(); return; }
  if (action === 'deploy-plan') { run(['--cwd', cwd, 'deploy', 'plan']); await pressEnter(); return; }
  if (action === 'deploy-assist') { run(['--cwd', cwd, 'deploy', 'assist']); await pressEnter(); return; }
  if (action === 'deploy-apply') {
    const plan = await promptLine('Path to deploy-plan.json');
    if (plan) { run(['--cwd', cwd, 'deploy', 'apply', '--plan', plan]); await pressEnter(); }
    return;
  }
  if (action === 'deploy-check') {
    const url = await promptLine('Healthcheck URL');
    if (url) { run(['--cwd', cwd, 'deploy', 'check', url]); await pressEnter(); }
    return;
  }
  run(['--cwd', cwd, ...(DIRECT_COMMANDS[action] ?? [action])]);
  await pressEnter();
}

async function runAdvancedMenu(cwd: string): Promise<void> {
  const action = await selectOne('Avançado', [
    { label: 'Audit com personas', hint: 'seleção manual de preset/domínios', value: 'audit' },
    { label: 'Churn', hint: 'histórico git e hotspots sociais', value: 'churn' },
    { label: 'Diff',  hint: 'comparar relatórios de auditoria', value: 'diff' },
    { label: 'Cloud', hint: 'infra cloud read-only',            value: 'cloud' },
    { label: 'MCP',   hint: 'expor tools para Claude Desktop',  value: 'mcp' },
    { label: 'Eval',  hint: 'medir retrieval e rerank',         value: 'eval' },
    { label: 'Trace', hint: 'histórico de custo/latência',      value: 'trace' },
    { label: '← Back', value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'audit') { await runAuditMenu(cwd); return; }
  if (action === 'cloud') { await runCloudMenu(cwd); return; }
  if (action === 'mcp') { await runMcpMenu(cwd); return; }
  if (action === 'eval') { await runEvalMenu(cwd); return; }
  run(['--cwd', cwd, ...(DIRECT_COMMANDS[action] ?? [action])]);
  await pressEnter();
}

// ── Fallback (non-TTY) ────────────────────────────────────────────────────────

export function runMenuFallback(cwd: string): void {
  const projectName = cwd.split('/').pop() ?? cwd;
  console.log('');
  console.log(chalk.bold.cyan(`  🤖 aion — ${projectName}`));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  console.log(chalk.dim('  Run from an interactive terminal to get the menu.'));
  console.log('');
  console.log(chalk.bold('  Estado:   ') + chalk.cyan('aion health  · aion scan secrets  · aion tree --hotspots'));
  console.log(chalk.bold('  Setup:    ') + chalk.cyan('aion setup'));
  console.log(chalk.bold('  Problemas:') + chalk.cyan('aion audit . --domains bugs --scanners 1  · aion report'));
  console.log(chalk.bold('  Código:   ') + chalk.cyan('aion graph   · aion search "<q>"  · aion impact-local <file>'));
  console.log(chalk.bold('  IA:       ') + chalk.cyan('aion fix <file>  · aion analyze "<bug>"  · aion review <file>'));
  console.log(chalk.bold('  Operar:   ') + chalk.cyan('aion assist  · aion ci assist  · aion deploy assist'));
  console.log('');
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function runMenu(cwd: string): Promise<void> {
  if (!process.stdin.isTTY) { runMenuFallback(cwd); return; }

  let info = cwd.split('/').pop() ?? cwd;
  try {
    const { GraphAgent } = await import('../agents/graph-agent.js');
    const index = new GraphAgent(cwd).getIndex();
    if (index) info += ` · ${index.stats.files} files`;
  } catch { /* best-effort */ }

  try {
    const { existsSync, readFileSync } = await import('fs');
    const { join } = await import('path');
    const historyFile = join(cwd, '.ai-runtime', 'reports', 'audit-history.json');
    if (existsSync(historyFile)) {
      const history = JSON.parse(readFileSync(historyFile, 'utf8')) as Array<{ criticalCount: number; highCount: number; createdAt: string }>;
      const last = history.at(-1);
      if (last) {
        const ago = Math.round((Date.now() - new Date(last.createdAt).getTime()) / 60000);
        const agoStr = ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
        const crit = last.criticalCount > 0 ? chalk.red(`${last.criticalCount} critical`) : '';
        const high = last.highCount > 0 ? chalk.yellow(`${last.highCount} high`) : '';
        const counts = [crit, high].filter(Boolean).join(', ');
        info += ` · last audit ${agoStr}${counts ? ': ' + counts : ' — clean'}`;
      }
    }
  } catch { /* best-effort */ }

  while (true) {
    console.log('');
    printHeader(cwd.split('/').pop() ?? cwd, info);
    const action = await selectOne('What do you want to run?', MAIN_ITEMS);

    if (!action || action === 'quit') break;
    if (action === 'sep' || action === '') continue;

    // Submenus
    if (action === 'status')   { await runStatusMenu(cwd); continue; }
    if (action === 'setup')    { run(['--cwd', cwd, 'setup']); await pressEnter(); continue; }
    if (action === 'problems') { await runProblemsMenu(cwd); continue; }
    if (action === 'explore')  { await runExploreMenu(cwd); continue; }
    if (action === 'ai-help')  { await runAiHelpMenu(cwd); continue; }
    if (action === 'publish')  { await runPublishMenu(cwd); continue; }
    if (action === 'advanced') { await runAdvancedMenu(cwd); continue; }
    if (action === 'audit')   { await runAuditMenu(cwd); continue; }
    if (action === 'scan')    { await runScanMenu(cwd); continue; }
    if (action === 'memory')  { await runMemoryMenu(cwd); continue; }
    if (action === 'explain') { await runExplainMenu(cwd); continue; }
    if (action === 'docs')    { await runDocsMenu(cwd); continue; }
    if (action === 'cloud')   { await runCloudMenu(cwd); continue; }
    if (action === 'mcp')     { await runMcpMenu(cwd); continue; }
    if (action === 'eval')    { await runEvalMenu(cwd); continue; }

    // Prompt-based
    if (action === 'fix') {
      const file = await promptLine('File to fix (relative path)');
      if (file) { run(['--cwd', cwd, 'fix', file]); await pressEnter(); }
      continue;
    }
    if (action === 'analyze') {
      const target = await promptLine('Describe the bug or issue');
      if (target) { run(['--cwd', cwd, 'analyze', target]); await pressEnter(); }
      continue;
    }
    if (action === 'review') {
      const target = await promptLine('File path or diff to review');
      if (target) { run(['--cwd', cwd, 'review', target]); await pressEnter(); }
      continue;
    }
    if (action === 'search') {
      const q = await promptLine('Search query');
      if (q) { run(['--cwd', cwd, 'search', q]); await pressEnter(); }
      continue;
    }
    if (action === 'impact') {
      const file = await promptLine('File path for impact analysis');
      if (file) { run(['--cwd', cwd, 'impact-local', file, '--rebuild']); await pressEnter(); }
      continue;
    }
    if (action === 'nl') {
      const { runInteractive } = await import('./interactive.js');
      await runInteractive(cwd);
      break;
    }

    // Direct commands
    const command = DIRECT_COMMANDS[action];
    const args = command ? ['--cwd', cwd, ...command] : undefined;
    if (args) {
      console.log(chalk.bold.cyan(`\nRunning ${action}…\n`));
      run(args);
      await pressEnter();
    }
  }

  console.log(chalk.dim('\nBye!\n'));
}
