import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { selectOne, selectMany, printHeader } from './tui.js';
import type { MenuItem } from './tui.js';
import type { ScanDomain } from '../prompts/scanner.js';

const ALL_DOMAINS: Array<MenuItem<ScanDomain>> = [
  { label: 'security',       hint: 'pentester finding attack vectors',                    value: 'security' },
  { label: 'bugs',           hint: 'QA hunting logic failures & null dereferences',       value: 'bugs' },
  { label: 'redundancy',     hint: 'architect eliminating dead/duplicate code',           value: 'redundancy' },
  { label: 'error-handling', hint: 'SRE finding silent failure points',                   value: 'error-handling' },
  { label: 'architecture',   hint: 'tech lead evaluating coupling & debt',                value: 'architecture' },
  { label: 'testing',        hint: 'QA engineer mapping test coverage gaps',              value: 'testing' },
  { label: 'performance',    hint: 'platform engineer hunting bottlenecks',               value: 'performance' },
  { label: 'infrastructure', hint: 'DevOps reviewing K8s & containers',                  value: 'infrastructure' },
  { label: 'observability',  hint: 'SRE checking logging, tracing & metrics',            value: 'observability' },
  { label: 'resilience',     hint: 'reliability eng: timeouts, retries, circuit breakers', value: 'resilience' },
  { label: 'data',           hint: 'DBA finding N+1 queries & missing indexes',          value: 'data' },
  { label: 'dependencies',   hint: 'security eng on supply chain & CVEs',                value: 'dependencies' },
  { label: 'compliance',     hint: 'DPO verifying LGPD/GDPR compliance',                 value: 'compliance' },
  { label: 'multitenancy',   hint: 'architect verifying tenant isolation',                value: 'multitenancy' },
  { label: 'prompt-audit',   hint: 'AI eng auditing LLM prompts & injection',            value: 'prompt-audit' },
];

const PRESETS: Array<MenuItem<string>> = [
  { label: '🔐 Security',  hint: 'security, compliance, dependencies, multitenancy',              value: 'security' },
  { label: '🤖 AI/LLM',   hint: 'prompt-audit, security, resilience, observability, data',       value: 'ai' },
  { label: '⚙️  Backend',  hint: 'security, data, error-handling, resilience, performance',       value: 'backend' },
  { label: '🛠️  DevOps',   hint: 'infrastructure, observability, resilience, dependencies',       value: 'devops' },
  { label: '✨ Quality',   hint: 'bugs, architecture, testing, redundancy, error-handling',       value: 'quality' },
  { label: '🏢 SaaS',      hint: 'multitenancy, compliance, security, resilience, observability', value: 'saas' },
  { label: '🏦 FinTech',   hint: 'compliance, security, data, multitenancy, error-handling',      value: 'fintech' },
  { label: '🌍 Full',      hint: 'all 15 personas (requires --force-full)',                       value: 'full' },
  { label: '📝 Custom…',   hint: 'select individual personas with Space',                         value: 'custom' },
  { label: '← Back',      value: 'back' },
];

const BUDGETS: Array<MenuItem<string>> = [
  { label: 'low',    hint: 'fast & cheap   · est. $0.10–0.50',  value: 'low' },
  { label: 'normal', hint: 'balanced       · est. $0.50–2.00',  value: 'normal' },
  { label: 'deep',   hint: 'thorough       · est. $2.00–5.00',  value: 'deep' },
];

const SCAN_ITEMS: Array<MenuItem<string>> = [
  { label: 'api-map',        hint: 'endpoints with auth/rate-limit status',     value: 'api-map' },
  { label: 'env-audit',      hint: 'env vars documented vs undocumented',       value: 'env-audit' },
  { label: 'cognitive-load', hint: 'nesting, magic numbers, long functions',    value: 'cognitive-load' },
  { label: 'secrets',        hint: 'hardcoded credentials in source files',     value: 'secrets' },
  { label: 'sbom',           hint: 'software bill of materials + unpinned deps',value: 'sbom' },
  { label: '← Back',        value: 'back' },
];

const MAIN_ITEMS: Array<MenuItem<string>> = [
  { label: 'Analyze',  value: '', header: true },
  { label: '🔍 Audit',    hint: 'multi-persona AI analysis',        value: 'audit' },
  { label: '💊 Health',   hint: 'composite score 0-100',            value: 'health' },
  { label: '🔬 Scan',     hint: 'zero-token local scans',           value: 'scan' },
  { label: '🔀 Diff',     hint: 'compare two audit runs',           value: 'diff' },
  { label: 'Explore',  value: '', header: true },
  { label: '🌐 Graph',    hint: 'interactive dependency map',        value: 'graph' },
  { label: '📈 Churn',    hint: 'git churn + bus factor',           value: 'churn' },
  { label: '🌲 Tree',     hint: 'tree view with finding hotspots',  value: 'tree' },
  { label: '🏗️  Patterns', hint: 'architecture pattern detection',  value: 'patterns' },
  { label: 'AI Assist', value: '', header: true },
  { label: '➡️  Next',    hint: 'recommended low-token next action', value: 'next' },
  { label: '💬 Explain',  hint: 'AI explanation + onboarding guide', value: 'explain' },
  { label: '🧾 Context',  hint: 'compact AI-safe context',          value: 'context' },
  { label: '🔧 Fix',      hint: 'AI-guided fix for a finding',      value: 'fix' },
  { label: '💭 Chat',     hint: 'interactive AI chat about the repo', value: 'chat' },
  { label: '🔬 Analyze',  hint: 'investigate a bug or issue',        value: 'analyze' },
  { label: '👁️  Review',   hint: 'review a file or diff for bugs',   value: 'review' },
  { label: 'Utilities', value: '', header: true },
  { label: '📊 Report',   hint: 'health + findings + context.md',   value: 'report' },
  { label: '🔎 Search',   hint: 'repo index search',                value: 'search' },
  { label: '🧠 Memory',   hint: 'build/search repo knowledge index', value: 'memory' },
  { label: '⚙️  Init',     hint: 'create .aionrc.json + .aionignore', value: 'init' },
  { label: '📚 Docs',     hint: 'quick start, providers, examples', value: 'docs' },
  { label: '', value: 'sep', separator: true },
  { label: '❯ Natural language', hint: 'type a request in Portuguese or English', value: 'nl' },
  { label: '  Quit', value: 'quit' },
];

function run(args: string[]): void {
  const result = spawnSync(process.execPath, [process.argv[1]!, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) console.error(chalk.red(result.error.message));
}

async function promptLine(question: string): Promise<string> {
  const rl = (await import('readline')).createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(chalk.cyan(`  ${question}: `), (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

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

  const budgetHint = BUDGETS.find((b) => b.value === budget)?.hint ?? '';
  const confirm = await selectOne(
    `Run audit? preset=${preset}  budget=${budget}  ${budgetHint}`,
    [
      { label: '✓ Run now', value: 'run' },
      { label: '✗ Cancel',  value: 'cancel' },
    ],
  );
  if (confirm !== 'run') return;

  console.log(chalk.bold.cyan('\nStarting audit…\n'));
  run(['--cwd', cwd, 'audit', '.', ...domainArgs, '--budget', budget]);
}

async function runScanMenu(cwd: string): Promise<void> {
  const item = await selectOne('Select scan type', SCAN_ITEMS);
  if (!item || item === 'back') return;
  console.log(chalk.bold.cyan(`\nRunning scan: ${item}…\n`));
  run(['--cwd', cwd, 'scan', item]);
}

async function runSearchMenu(cwd: string): Promise<void> {
  const query = await promptLine('Search query');
  if (!query) return;
  console.log(chalk.bold.cyan(`\nSearching: ${query}…\n`));
  run(['--cwd', cwd, 'search', query]);
}

async function runAnalyzeMenu(cwd: string): Promise<void> {
  const target = await promptLine('Describe the bug or issue');
  if (!target) return;
  console.log(chalk.bold.cyan('\nRunning analysis…\n'));
  run(['--cwd', cwd, 'analyze', target]);
}

async function runReviewMenu(cwd: string): Promise<void> {
  const target = await promptLine('File path or diff to review');
  if (!target) return;
  console.log(chalk.bold.cyan(`\nReviewing ${target}…\n`));
  run(['--cwd', cwd, 'review', target]);
}

async function runMemoryMenu(cwd: string): Promise<void> {
  const action = await selectOne('Memory action', [
    { label: 'build',   hint: 'index source files into knowledge store',      value: 'build' },
    { label: 'index',   hint: 'build repo index for fast file/symbol lookup', value: 'index' },
    { label: 'search',  hint: 'semantic search (requires memory build)',       value: 'search' },
    { label: 'query',   hint: 'file + symbol lookup from repo index',          value: 'query' },
    { label: 'deps',    hint: 'show dependency report',                        value: 'deps' },
    { label: '← Back', value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'search' || action === 'query') {
    const prompt = action === 'query' ? 'Symbol or file to look up' : 'Search query';
    const q = await promptLine(prompt);
    if (!q) return;
    console.log(chalk.bold.cyan(`\nRunning memory ${action}…\n`));
    run(['--cwd', cwd, 'memory', action, q]);
    return;
  }
  console.log(chalk.bold.cyan(`\nRunning memory ${action}…\n`));
  run(['--cwd', cwd, 'memory', action]);
}

async function runFixMenu(cwd: string): Promise<void> {
  const file = await promptLine('File to fix (relative path)');
  if (!file) return;
  const issue = await promptLine('Describe the issue (optional, Enter to skip)');
  const args = ['--cwd', cwd, 'fix', file];
  if (issue) args.push('--issue', issue);
  console.log(chalk.bold.cyan(`\nRunning fix on ${file}…\n`));
  run(args);
}

async function runExplainMenu(cwd: string): Promise<void> {
  const mode = await selectOne('Select mode', [
    { label: 'explain <file>', hint: 'what a file does and why it matters', value: 'explain' },
    { label: 'impact <file>',  hint: 'blast radius if this file changes',   value: 'impact' },
    { label: 'onboard',        hint: 'developer onboarding guide',          value: 'onboard' },
    { label: '← Back',        value: 'back' },
  ]);
  if (!mode || mode === 'back') return;

  if (mode === 'onboard') {
    console.log(chalk.bold.cyan('\nGenerating onboarding guide…\n'));
    run(['--cwd', cwd, 'onboard']);
    return;
  }

  const file = await promptLine('File path');
  if (!file) return;

  console.log(chalk.bold.cyan(`\nRunning ${mode} on ${file}…\n`));
  run(['--cwd', cwd, mode, file]);
}

function printDocumentation(): void {
  console.log('');
  console.log(chalk.bold.cyan('  Aion Documentation'));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  console.log('');
  console.log(chalk.bold('  Quick start'));
  console.log(`  ${chalk.cyan('aion menu')}                         open this menu`);
  console.log(`  ${chalk.cyan('aion next')}                         recommended low-token flow`);
  console.log(`  ${chalk.cyan('aion audit . --preset security')}    security-focused audit`);
  console.log(`  ${chalk.cyan('aion audit . --max-files 20')}       cap AI file scope`);
  console.log(`  ${chalk.cyan('aion context --audit')}              compact AI-safe audit context`);
  console.log(`  ${chalk.cyan('aion search "<query>"')}             search repo index`);
  console.log(`  ${chalk.cyan('aion tree --hotspots')}              tree view with latest findings`);
  console.log(`  ${chalk.cyan('aion report latest')}                latest report paths`);
  console.log(`  ${chalk.cyan('aion scan secrets')}                 local secret scan`);
  console.log(`  ${chalk.cyan('aion scan env-audit')}               env var documentation check`);
  console.log(`  ${chalk.cyan('aion scan sbom --unpinned-only')}    supply-chain pinning check`);
  console.log(`  ${chalk.cyan('aion report --md')}                  markdown report`);
  console.log('');
  console.log(chalk.bold('  AI providers'));
  console.log(`  ${chalk.cyan('ANTHROPIC_API_KEY')}                 Claude SDK provider`);
  console.log(`  ${chalk.cyan('claude /login')}                     Claude CLI fallback`);
  console.log(`  ${chalk.cyan('OPENROUTER_API_KEY')}                OpenRouter provider`);
  console.log('');
  console.log(chalk.bold('  Audit presets'));
  console.log('  security · ai · backend · devops · quality · saas · fintech · full');
  console.log('');
  console.log(chalk.bold('  Natural language examples'));
  console.log(`  ${chalk.cyan('aion "audit this repo for dependency risks"')}`);
  console.log(`  ${chalk.cyan('aion "review src/auth/middleware.ts"')}`);
  console.log(`  ${chalk.cyan('aion "explain the payment flow"')}`);
  console.log('');
  console.log(chalk.bold('  Runtime files'));
  console.log(`  ${chalk.cyan('.ai-runtime/reports/index.html')}    audit dashboard`);
  console.log(`  ${chalk.cyan('.ai-runtime/reports/audits/')}       per-run reports`);
  console.log(`  ${chalk.cyan('~/.aion/update-check.json')}         update cache`);
  console.log('');
  console.log(chalk.dim('  npm: https://www.npmjs.com/package/@aionlabsai/aion'));
  console.log('');
}

function runMenuFallback(cwd: string): void {
  const projectName = cwd.split('/').pop() ?? cwd;
  console.log('');
  console.log(chalk.bold.cyan(`  🤖 AI Runtime — ${projectName}`));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  console.log(chalk.dim('  Run from an interactive terminal to get the menu.'));
  console.log('');
  console.log(chalk.bold('  Available commands:'));
  console.log('');
  console.log(`  ${chalk.cyan('aion menu')}                    interactive menu`);
  console.log(`  ${chalk.cyan('aion next')}                    recommended next action`);
  console.log(`  ${chalk.cyan('aion audit . --preset ai')}     AI/LLM audit`);
  console.log(`  ${chalk.cyan('aion health')}                  composite health score`);
  console.log(`  ${chalk.cyan('aion report --md')}             full markdown report`);
  console.log(`  ${chalk.cyan('aion graph')}                   dependency graph`);
  console.log(`  ${chalk.cyan('aion churn')}                   git churn analysis`);
  console.log(`  ${chalk.cyan('aion scan secrets')}            secret scan`);
  console.log(`  ${chalk.cyan('aion patterns')}                architecture patterns`);
  console.log('');
}

export async function runMenu(cwd: string): Promise<void> {
  if (!process.stdin.isTTY) {
    runMenuFallback(cwd);
    return;
  }

  let info = cwd.split('/').pop() ?? cwd;
  try {
    const { GraphAgent } = await import('../agents/graph-agent.js');
    const graph = new GraphAgent(cwd);
    const index = graph.getIndex();
    if (index) info += ` · ${index.stats.files} files`;
  } catch { /* best-effort */ }

  // Show last audit summary in header if available
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

  const cmdMap: Record<string, string[]> = {
    report:   ['--cwd', cwd, 'report'],
    next:     ['--cwd', cwd, 'next'],
    context:  ['--cwd', cwd, 'context', '--audit'],
    tree:     ['--cwd', cwd, 'tree', '--hotspots'],
    graph:    ['--cwd', cwd, 'graph'],
    churn:    ['--cwd', cwd, 'churn'],
    patterns: ['--cwd', cwd, 'patterns'],
    health:   ['--cwd', cwd, 'health'],
    chat:     ['--cwd', cwd, 'chat'],
    diff:     ['--cwd', cwd, 'diff'],
    init:     ['--cwd', cwd, 'init'],
  };

  while (true) {
    console.log('');
    printHeader(cwd.split('/').pop() ?? cwd, info);
    const action = await selectOne('What do you want to run?', MAIN_ITEMS);

    if (!action || action === 'quit') break;
    if (action === 'sep' || action === '') continue;

    if (action === 'audit')   { await runAuditMenu(cwd); continue; }
    if (action === 'scan')    { await runScanMenu(cwd); continue; }
    if (action === 'explain') { await runExplainMenu(cwd); continue; }
    if (action === 'search')  { await runSearchMenu(cwd); continue; }
    if (action === 'fix')     { await runFixMenu(cwd); continue; }
    if (action === 'analyze') { await runAnalyzeMenu(cwd); continue; }
    if (action === 'review')  { await runReviewMenu(cwd); continue; }
    if (action === 'memory')  { await runMemoryMenu(cwd); continue; }
    if (action === 'docs')    { printDocumentation(); continue; }
    if (action === 'nl') {
      const { runInteractive } = await import('./interactive.js');
      await runInteractive(cwd);
      break;
    }

    const args = cmdMap[action];
    if (args) {
      console.log(chalk.bold.cyan(`\nRunning ${action}…\n`));
      run(args);
    }

    const cont = await selectOne('', [
      { label: '← Back to menu', value: 'menu' },
      { label: '  Quit',         value: 'quit' },
    ]);
    if (cont === 'quit' || !cont) break;
  }

  console.log(chalk.dim('\nBye!\n'));
}
