import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { selectOne, selectMany, printHeader } from './tui.js';
import type { MenuItem } from './tui.js';
import type { ScanDomain } from '../prompts/scanner.js';

const ALL_DOMAINS: Array<MenuItem<ScanDomain>> = [
  { label: 'security',       hint: 'pentester finding attack vectors',          value: 'security' },
  { label: 'bugs',           hint: 'QA hunting logic failures & null dereference', value: 'bugs' },
  { label: 'redundancy',     hint: 'architect eliminating dead/duplicate code', value: 'redundancy' },
  { label: 'error-handling', hint: 'SRE finding silent failure points',         value: 'error-handling' },
  { label: 'architecture',   hint: 'tech lead evaluating coupling & debt',       value: 'architecture' },
  { label: 'testing',        hint: 'QA engineer mapping test coverage gaps',    value: 'testing' },
  { label: 'performance',    hint: 'platform engineer hunting bottlenecks',      value: 'performance' },
  { label: 'infrastructure', hint: 'DevOps reviewing K8s & containers',         value: 'infrastructure' },
  { label: 'observability',  hint: 'SRE checking logging, tracing & metrics',   value: 'observability' },
  { label: 'resilience',     hint: 'reliability eng: timeouts, retries, circuit breakers', value: 'resilience' },
  { label: 'data',           hint: 'DBA finding N+1 queries & missing indexes', value: 'data' },
  { label: 'dependencies',   hint: 'security eng on supply chain & CVEs',       value: 'dependencies' },
  { label: 'compliance',     hint: 'DPO verifying LGPD/GDPR compliance',        value: 'compliance' },
  { label: 'multitenancy',   hint: 'architect verifying tenant isolation',       value: 'multitenancy' },
  { label: 'prompt-audit',   hint: 'AI eng auditing LLM prompts & injection',   value: 'prompt-audit' },
];

const PRESETS: Array<MenuItem<string>> = [
  { label: '🔐 Security',   hint: 'security, compliance, dependencies, multitenancy', value: 'security' },
  { label: '🤖 AI/LLM',    hint: 'prompt-audit, security, resilience, observability, data', value: 'ai' },
  { label: '⚙️  Backend',   hint: 'security, data, error-handling, resilience, performance', value: 'backend' },
  { label: '🛠️  DevOps',    hint: 'infrastructure, observability, resilience, dependencies', value: 'devops' },
  { label: '✨ Quality',    hint: 'bugs, architecture, testing, redundancy, error-handling', value: 'quality' },
  { label: '🏢 SaaS',       hint: 'multitenancy, compliance, security, resilience, observability', value: 'saas' },
  { label: '🏦 FinTech',    hint: 'compliance, security, data, multitenancy, error-handling', value: 'fintech' },
  { label: '🌍 Full',       hint: 'all 15 personas; CLI requires --force-full', value: 'full' },
  { label: '📝 Custom…',    hint: 'select individual personas with Space', value: 'custom' },
  { label: '← Back',       value: 'back' },
];

const BUDGETS: Array<MenuItem<string>> = [
  { label: 'low',    hint: 'Haiku — fast, $0.10-0.50',        value: 'low' },
  { label: 'normal', hint: 'Sonnet — balanced, $0.50-2.00',   value: 'normal' },
  { label: 'deep',   hint: 'Opus — thorough, $2.00-5.00',     value: 'deep' },
];

const SCAN_ITEMS: Array<MenuItem<string>> = [
  { label: 'api-map',        hint: 'endpoints with auth/rate-limit status',    value: 'api-map' },
  { label: 'env-audit',      hint: 'env vars documented vs undocumented',      value: 'env-audit' },
  { label: 'cognitive-load', hint: 'nesting, magic numbers, long functions',    value: 'cognitive-load' },
  { label: 'secrets',        hint: 'hardcoded credentials in current files',    value: 'secrets' },
  { label: 'sbom',           hint: 'software bill of materials + unpinned deps', value: 'sbom' },
  { label: '← Back',        value: 'back' },
];

function run(args: string[]): void {
  const result = spawnSync(process.execPath, [process.argv[1]!, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) console.error(chalk.red(result.error.message));
}

async function runAuditMenu(cwd: string): Promise<void> {
  const preset = await selectOne('Select persona preset', PRESETS,
    'Each preset is a team of specialized AI personas');
  if (!preset || preset === 'back') return;

  let domainsFlag = '';
  if (preset === 'custom') {
    const chosen = await selectMany(
      'Select personas',
      ALL_DOMAINS,
      'Space to toggle, Enter to confirm',
    );
    if (!chosen || chosen.length === 0) return;
    domainsFlag = `--domains ${chosen.join(',')}`;
  } else {
    domainsFlag = `--preset ${preset}`;
  }

  const budget = await selectOne('Select budget', BUDGETS);
  if (!budget) return;

  const confirm = await selectOne(
    `Run audit with ${domainsFlag} --budget ${budget}?`,
    [
      { label: '✓ Run now',  value: 'run' },
      { label: '✗ Cancel',   value: 'cancel' },
    ],
  );
  if (confirm !== 'run') return;

  console.log(chalk.bold.cyan('\nStarting audit…\n'));
  run(['--cwd', cwd, 'audit', '.', domainsFlag.split(' ')[0]!, domainsFlag.split(' ')[1] ?? '', '--budget', budget]);
}

async function runScanMenu(cwd: string): Promise<void> {
  const item = await selectOne('Select scan type', SCAN_ITEMS);
  if (!item || item === 'back') return;
  console.log(chalk.bold.cyan(`\nRunning scan ${item}…\n`));
  run(['--cwd', cwd, 'scan', item]);
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

  // Ask for file path
  const rl = (await import('readline')).createInterface({ input: process.stdin, output: process.stdout });
  const file = await new Promise<string>((resolve) => {
    rl.question(chalk.cyan(`  File path: `), (ans) => { rl.close(); resolve(ans.trim()); });
  });
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
  console.log(`  ${chalk.cyan('aion audit . --max-files 20')}        cap AI file scope`);
  console.log(`  ${chalk.cyan('aion context --audit')}              compact AI-safe audit context`);
  console.log(`  ${chalk.cyan('aion search "audit reports"')}       search repo index`);
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
  console.log(`  ${chalk.cyan('AI_RUNTIME_CODEX_MODEL')}            Codex model override`);
  console.log('');
  console.log(chalk.bold('  Audit presets'));
  console.log('  security, ai, backend, devops, quality, saas, fintech, full');
  console.log('');
  console.log(chalk.bold('  Natural language examples'));
  console.log(`  ${chalk.cyan('aion "audit this repo for dependency risks"')}`);
  console.log(`  ${chalk.cyan('aion "review src/auth/middleware.ts"')}`);
  console.log(`  ${chalk.cyan('aion "explain the payment flow"')}`);
  console.log('');
  console.log(chalk.bold('  Runtime files'));
  console.log(`  ${chalk.cyan('.ai-runtime/')}                      reports and repo indexes`);
  console.log(`  ${chalk.cyan('.ai-runtime/reports/audits/')}       organized audit runs`);
  console.log(`  ${chalk.cyan('.ai-memory/')}                       optional knowledge base`);
  console.log(`  ${chalk.cyan('AI_RUNTIME_DB_PATH')}                task store override`);
  console.log('');
  console.log(chalk.dim('  Full README: https://www.npmjs.com/package/@aionlabsai/aion'));
  console.log('');
}

const MAIN_ITEMS: Array<MenuItem<string>> = [
  { label: '🔍 Audit',           hint: 'multi-persona code analysis',        value: 'audit' },
  { label: '➡️  Next',            hint: 'recommended low-token flow',         value: 'next' },
  { label: '🧾 Context',         hint: 'compact AI-safe context',            value: 'context' },
  { label: '🔎 Search',          hint: 'repo index search without tokens',    value: 'search' },
  { label: '🌲 Tree',            hint: 'tree + latest finding hotspots',      value: 'tree' },
  { label: '📊 Report',          hint: 'health + findings + context.md',     value: 'report' },
  { label: '🌐 Graph',           hint: 'interactive dependency map',          value: 'graph' },
  { label: '📈 Churn',           hint: 'git churn + bus factor',             value: 'churn' },
  { label: '🔬 Scan',            hint: 'quick zero-token scans',             value: 'scan' },
  { label: '🏗️  Patterns',        hint: 'architecture pattern detection',     value: 'patterns' },
  { label: '💊 Health',          hint: 'composite score 0-100',             value: 'health' },
  { label: '💬 Explain / Onboard', hint: 'AI explanation + onboarding',     value: 'explain' },
  { label: '📚 Documentation',    hint: 'quick start, providers, scans',      value: 'docs' },
  { label: '─', value: 'sep', separator: true },
  { label: '❯ Natural language', hint: 'type a request in Portuguese or English', value: 'nl' },
  { label: '  Quit',            value: 'quit' },
];

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
  console.log(`  ${chalk.cyan('aion audit . --preset ai')}     AI/LLM audit`);
  console.log(`  ${chalk.cyan('aion audit --list-personas')}   show all personas`);
  console.log(`  ${chalk.cyan('aion health')}                  composite health score`);
  console.log(`  ${chalk.cyan('aion report --md')}             full markdown report`);
  console.log(`  ${chalk.cyan('aion graph')}                   dependency graph`);
  console.log(`  ${chalk.cyan('aion churn')}                   git churn analysis`);
  console.log(`  ${chalk.cyan('aion scan api-map')}            API endpoint map`);
  console.log(`  ${chalk.cyan('aion patterns')}                architecture patterns`);
  console.log(`  ${chalk.cyan('aion onboard')}                 developer guide (AI)`);
  console.log(`  ${chalk.cyan('aion menu')}                    includes documentation`);
  console.log('');
}

export async function runMenu(cwd: string): Promise<void> {
  if (!process.stdin.isTTY) {
    runMenuFallback(cwd);
    return;
  }

  // Show project info
  let info = cwd.split('/').pop() ?? cwd;
  try {
    const { GraphAgent } = await import('../agents/graph-agent.js');
    const graph = new GraphAgent(cwd);
    const index = graph.getIndex();
    if (index) info += ` · ${index.stats.files} files`;
  } catch { /* best-effort */ }

  while (true) {
    console.log('');
    printHeader(cwd.split('/').pop() ?? cwd, info);
    const action = await selectOne('What do you want to run?', MAIN_ITEMS);

    if (!action || action === 'quit') break;

    if (action === 'audit')    { await runAuditMenu(cwd); continue; }
    if (action === 'scan')     { await runScanMenu(cwd); continue; }
    if (action === 'explain')  { await runExplainMenu(cwd); continue; }
    if (action === 'docs')     { printDocumentation(); }
    if (action === 'sep')      continue;
    if (action === 'nl') {
      const { runInteractive } = await import('./interactive.js');
      await runInteractive(cwd);
      break;
    }

    // Simple commands
    const cmdMap: Record<string, string[]> = {
      report:   ['--cwd', cwd, 'report'],
      next:     ['--cwd', cwd, 'next'],
      context:  ['--cwd', cwd, 'context', '--audit'],
      search:   ['--cwd', cwd, 'search', 'audit reports'],
      tree:     ['--cwd', cwd, 'tree', '--hotspots'],
      graph:    ['--cwd', cwd, 'graph'],
      churn:    ['--cwd', cwd, 'churn'],
      patterns: ['--cwd', cwd, 'patterns'],
      health:   ['--cwd', cwd, 'health'],
    };
    const args = cmdMap[action];
    if (args) {
      console.log(chalk.bold.cyan(`\nRunning ${action}…\n`));
      run(args);
    }

    // After command, ask to continue
    const cont = await selectOne('', [
      { label: '← Back to menu', value: 'menu' },
      { label: '  Quit',         value: 'quit' },
    ]);
    if (cont === 'quit' || !cont) break;
  }

  console.log(chalk.dim('\nBye!\n'));
}
