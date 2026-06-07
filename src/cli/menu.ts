import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { selectOne, selectMany, printHeader } from './tui.js';
import type { MenuItem } from './tui.js';
import type { ScanDomain } from '../prompts/scanner.js';

// ── Data ──────────────────────────────────────────────────────────────────────

const ALL_DOMAINS: Array<MenuItem<ScanDomain>> = [
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

const PRESETS: Array<MenuItem<string>> = [
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

const BUDGETS: Array<MenuItem<string>> = [
  { label: 'low',    hint: 'fast & cheap   · est. $0.10–0.50', value: 'low' },
  { label: 'normal', hint: 'balanced       · est. $0.50–2.00', value: 'normal' },
  { label: 'deep',   hint: 'thorough       · est. $2.00–5.00', value: 'deep' },
];

// ── 5-category main menu ──────────────────────────────────────────────────────

const MAIN_ITEMS: Array<MenuItem<string>> = [
  { label: 'Inspect',   value: '', header: true },
  { label: '💊 Health',    hint: 'composite score 0–100',              value: 'health' },
  { label: '🔬 Scan',      hint: 'zero-token: secrets, env, api-map',  value: 'scan' },
  { label: '📈 Churn',     hint: 'git churn + knowledge silos',        value: 'churn' },
  { label: '🌲 Tree',      hint: 'file tree with finding hotspots',    value: 'tree' },
  { label: '🔀 Diff',      hint: 'compare two audit runs',             value: 'diff' },

  { label: 'Explore',   value: '', header: true },
  { label: '🌐 Graph',     hint: 'interactive dependency map',         value: 'graph' },
  { label: '🔎 Search',    hint: 'repo index: files, symbols, chunks', value: 'search' },
  { label: '💥 Impact',    hint: 'what breaks if this file changes',   value: 'impact' },
  { label: '🧠 Memory',    hint: 'build/search code knowledge base',   value: 'memory' },

  { label: 'Audit',     value: '', header: true },
  { label: '🔍 Audit',     hint: 'multi-persona AI deep analysis',     value: 'audit' },
  { label: '🏗️  Patterns',  hint: 'architecture pattern detection',    value: 'patterns' },
  { label: '🏥 Report',    hint: 'full HTML + markdown report',        value: 'report' },

  { label: 'Fix',       value: '', header: true },
  { label: '🔧 Fix',       hint: 'AI-guided fix for a bug or finding', value: 'fix' },
  { label: '🔬 Analyze',   hint: 'investigate a bug or issue',         value: 'analyze' },
  { label: '👁️  Review',    hint: 'review a file or diff',             value: 'review' },
  { label: '💬 Explain',   hint: 'AI explanation + onboarding guide',  value: 'explain' },
  { label: '💭 Chat',      hint: 'interactive AI Q&A about the repo',  value: 'chat' },

  { label: 'Setup',     value: '', header: true },
  { label: '📚 Docs',      hint: 'analyze + generate project docs',    value: 'docs' },
  { label: '☁️  Cloud',     hint: 'read-only infra gap analysis',       value: 'cloud' },
  { label: '🔌 MCP',       hint: 'expose aion to Claude Desktop',      value: 'mcp' },
  { label: '📊 Eval',      hint: 'measure retrieval + agent quality',  value: 'eval' },
  { label: '📡 Trace',     hint: 'agent run history: cost & latency',  value: 'trace' },
  { label: '⚙️  Init',      hint: '.aionrc.json + .aionignore',         value: 'init' },

  { label: '', value: 'sep', separator: true },
  { label: '❯ Natural language', hint: 'type a request in any language', value: 'nl' },
  { label: '  Quit', value: 'quit' },
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

// ── Fallback (non-TTY) ────────────────────────────────────────────────────────

function runMenuFallback(cwd: string): void {
  const projectName = cwd.split('/').pop() ?? cwd;
  console.log('');
  console.log(chalk.bold.cyan(`  🤖 aion — ${projectName}`));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  console.log(chalk.dim('  Run from an interactive terminal to get the menu.'));
  console.log('');
  console.log(chalk.bold('  Inspect:  ') + chalk.cyan('aion health  · aion scan secrets  · aion churn'));
  console.log(chalk.bold('  Explore:  ') + chalk.cyan('aion graph   · aion search "<q>"  · aion impact-local <file>'));
  console.log(chalk.bold('  Audit:    ') + chalk.cyan('aion audit . --preset security  · aion audit . --budget low'));
  console.log(chalk.bold('  Fix:      ') + chalk.cyan('aion fix <file>  · aion analyze "<bug>"  · aion review <file>'));
  console.log(chalk.bold('  Setup:    ') + chalk.cyan('aion docs analyze  · aion cloud status  · aion mcp list-tools'));
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

  const directCmds: Record<string, string[]> = {
    health:   ['--cwd', cwd, 'health'],
    churn:    ['--cwd', cwd, 'churn'],
    tree:     ['--cwd', cwd, 'tree', '--hotspots'],
    diff:     ['--cwd', cwd, 'diff'],
    graph:    ['--cwd', cwd, 'graph'],
    patterns: ['--cwd', cwd, 'patterns'],
    report:   ['--cwd', cwd, 'report'],
    chat:     ['--cwd', cwd, 'chat'],
    init:     ['--cwd', cwd, 'init'],
    impact:   ['--cwd', cwd, 'impact-local', '--rebuild'],
    trace:    ['--cwd', cwd, 'trace'],
  };

  while (true) {
    console.log('');
    printHeader(cwd.split('/').pop() ?? cwd, info);
    const action = await selectOne('What do you want to run?', MAIN_ITEMS);

    if (!action || action === 'quit') break;
    if (action === 'sep' || action === '') continue;

    // Submenus
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
    if (action === 'nl') {
      const { runInteractive } = await import('./interactive.js');
      await runInteractive(cwd);
      break;
    }

    // Direct commands
    const args = directCmds[action];
    if (args) {
      console.log(chalk.bold.cyan(`\nRunning ${action}…\n`));
      run(args);
      await pressEnter();
    }
  }

  console.log(chalk.dim('\nBye!\n'));
}
