import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { selectOne, printHeader } from './tui.js';
import type { MenuItem } from './tui.js';
import { displayProjectName } from '../infra/project-name.js';
import { AI_RUNTIME_DIR } from '../infra/paths.js';
import { isIgnoredDirName } from './cli-utils.js';
import { loadMenuPrefs, saveMenuPrefs } from './menu-prefs.js';

// ── Kept for external consumers (audit command, tests) ────────────────────────
export type { MenuItem };
export const ALL_DOMAINS = [
  { label: 'security',       hint: 'pentester looking for attack paths',                         value: 'security' },
  { label: 'bugs',           hint: 'QA finding logic bugs and null dereferences',                value: 'bugs' },
  { label: 'redundancy',     hint: 'architect removing dead and duplicate code',                 value: 'redundancy' },
  { label: 'error-handling', hint: 'SRE finding silent failure paths',                           value: 'error-handling' },
  { label: 'architecture',   hint: 'tech lead reviewing coupling and technical debt',            value: 'architecture' },
  { label: 'testing',        hint: 'QA mapping test coverage gaps',                              value: 'testing' },
  { label: 'performance',    hint: 'engineer finding platform bottlenecks',                      value: 'performance' },
  { label: 'infrastructure', hint: 'DevOps reviewing K8s and containers',                        value: 'infrastructure' },
  { label: 'observability',  hint: 'SRE checking logs, traces, and metrics',                     value: 'observability' },
  { label: 'resilience',     hint: 'reliability checks: timeouts, retries, circuit breakers',    value: 'resilience' },
  { label: 'data',           hint: 'DBA finding N+1 queries and missing indexes',                value: 'data' },
  { label: 'dependencies',   hint: 'supply-chain security and CVEs',                             value: 'dependencies' },
  { label: 'compliance',     hint: 'DPO checking GDPR/LGPD compliance',                          value: 'compliance' },
  { label: 'multitenancy',   hint: 'architect checking tenant isolation',                        value: 'multitenancy' },
  { label: 'prompt-audit',   hint: 'AI engineer auditing LLM prompts and injection risk',        value: 'prompt-audit' },
];

export const PRESETS = [
  { label: '🔐 Security', value: 'security' },
  { label: '⚙️  Backend',  value: 'backend' },
  { label: '🛠️  DevOps',   value: 'devops' },
  { label: '✨ Quality',  value: 'quality' },
  { label: '🌍 Full',    value: 'full' },
];

export const BUDGETS = [
  { label: 'low',    hint: 'fast and cheap   · est. $0.10–0.50', value: 'low' },
  { label: 'normal', hint: 'balanced         · est. $0.50–2.00', value: 'normal' },
  { label: 'deep',   hint: 'complete         · est. $2.00–5.00', value: 'deep' },
];

type AuditTrack = 'bugs' | 'security' | 'perf';
type AuditMode = 'local-only' | 'normal';
type MenuAction = 'local-check' | 'seo' | 'network-scan' | 'app-security' | 'bugs' | 'security' | 'perf' | 'copilot' | 'fix' | 'analyze' | 'assistant' | 'chat-qa' | 'report' | 'links' | 'change-provider' | 'doctor' | 'providers' | 'sep' | 'quit';

const PROVIDER_ITEMS = [
  { label: 'claude',      hint: 'Anthropic Claude (default)',        value: 'claude' },
  { label: 'minimax',     hint: 'MiniMax — requires MINIMAX_API_KEY', value: 'minimax' },
  { label: 'kimi',        hint: 'Moonshot Kimi — requires MOONSHOT_API_KEY', value: 'kimi' },
  { label: 'openrouter',  hint: 'OpenRouter — requires OPENROUTER_API_KEY', value: 'openrouter' },
  { label: 'codex',       hint: 'OpenAI Codex CLI',                  value: 'codex' },
];

const AUDIT_DOMAIN_ARGS: Record<AuditTrack, string> = {
  bugs: 'bugs,error-handling,architecture,testing',
  security: 'security,compliance,dependencies',
  perf: 'performance,observability,resilience',
};

const AUDIT_AI_DOMAIN_ARGS: Record<AuditTrack, string> = {
  bugs: 'bugs',
  security: 'security',
  perf: 'performance',
};

const AUDIT_MODE_ITEMS: Array<MenuItem<AuditMode>> = [
  { label: '🧪 Local', hint: 'zero token · complete local scan', value: 'local-only' },
  { label: '🤖 Normal AI', hint: 'uses tokens · balanced multi-agent analysis', value: 'normal' },
];

const PROJECT_LINKS = {
  github: 'https://github.com/halgorn/MultiAgents_Terminal',
  linkedin: 'https://www.linkedin.com/in/bruno-inacio-036530170/',
  email: 'brunoinacio3000@hotmail.com',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetTty(): void {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode!(false);
    process.stdout.write('\x1b[?25h');
  } catch { /* ok */ }
}

function drainStdin(): void {
  try {
    process.stdin.resume();
    let chunk;
    while ((chunk = process.stdin.read()) !== null) { void chunk; }
  } catch { /* ok */ }
}

function run(args: string[]): void {
  resetTty();
  const displayArgs = args.filter((a, i) => a !== '--cwd' && args[i - 1] !== '--cwd');
  console.log(chalk.dim(`\n  ⏳ aion ${displayArgs.join(' ')}  (Ctrl+C to cancel)\n`));
  const onSigint = () => { /* intentional: let child handle it, menu survives */ };
  process.on('SIGINT', onSigint);
  const result = spawnSync(process.execPath, [process.argv[1]!, ...args], {
    stdio: 'inherit', env: process.env,
  });
  process.removeListener('SIGINT', onSigint);
  resetTty();
  drainStdin();
  if (result.error) console.error(chalk.red(result.error.message));
  if (!result.error && result.status !== 0) {
    console.error(chalk.red(`\n  ⚠ Command failed with status ${result.status}`));
  }
}

async function pressAnyKey(autoMs = 6000): Promise<void> {
  resetTty();
  drainStdin();
  return new Promise<void>((resolve) => {
    const startedAt = Date.now();
    const remaining = () => Math.max(0, Math.ceil((autoMs - (Date.now() - startedAt)) / 1000));

    process.stdout.write(chalk.dim('\n  ──────────────────────────────────────────────────\n'));
    process.stdout.write(`\r  ${chalk.dim(`↵ any key to return  (${remaining()}s)`)}`);

    const ticker = setInterval(() => {
      const r = remaining();
      process.stdout.write(`\r  ${chalk.dim(`↵ any key to return  (${r}s)  `)}`);
      if (r === 0) cleanup(true);
    }, 1000);

    let resolved = false;
    const cleanup = (auto = false) => {
      if (resolved) return;
      resolved = true;
      clearInterval(ticker);
      process.stdin.removeListener('data', onData);
      process.removeListener('SIGINT', onSigint);
      process.stdout.write(auto ? chalk.dim('\n  (auto)\n') : '\n');
      drainStdin();
      resolve();
    };
    const onData = () => cleanup(false);
    const onSigint = () => { process.stdout.write('\n'); process.exit(0); };
    process.stdin.resume();
    process.stdin.once('data', onData);
    process.once('SIGINT', onSigint);
  });
}

async function promptLine(question: string): Promise<string> {
  resetTty();
  drainStdin();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    const onSigint = () => { rl.close(); process.removeListener('SIGINT', onSigint); resolve(''); };
    process.once('SIGINT', onSigint);
    rl.question(chalk.cyan(`  ${question}: `), (ans) => {
      process.removeListener('SIGINT', onSigint);
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function chooseAuditMode(cwd: string, track: AuditTrack): Promise<AuditMode | null> {
  const prefs = loadMenuPrefs(cwd);
  const lastLabel = prefs.lastAuditMode === 'local-only' ? 'Local' : prefs.lastAuditMode === 'normal' ? 'Normal AI' : null;
  const subtitle = lastLabel ? `last used: ${lastLabel}` : undefined;
  const mode = await selectOne(`Audit mode (${track})`, AUDIT_MODE_ITEMS, subtitle);
  if (!mode) return null;
  saveMenuPrefs(cwd, { lastAuditMode: mode });
  return mode;
}

function runAuditTrack(cwd: string, track: AuditTrack, mode: AuditMode, provider?: string): void {
  if (mode === 'local-only') {
    const args = ['--cwd', cwd, 'audit', '.', '--domains', AUDIT_DOMAIN_ARGS[track]];
    run([...args, '--local-only']);
    return;
  }
  const args = ['--cwd', cwd, 'audit', '.', '--domains', AUDIT_AI_DOMAIN_ARGS[track]];
  if (provider && provider !== 'claude') args.push('--provider', provider);
  run([...args, '--budget', 'normal']);
}

function currentLangfuseLabel(): string {
  return process.env['LANGFUSE_PUBLIC_KEY'] && process.env['LANGFUSE_SECRET_KEY']
    ? chalk.green('ON')
    : chalk.gray('OFF');
}

function showProjectLinks(): void {
  resetTty();
  console.log('');
  console.log(chalk.bold.cyan('  Project links'));
  console.log(chalk.dim('  ──────────────────────────────────────────────────'));
  console.log(`${chalk.bold('  GitHub:   ')}${chalk.cyan(PROJECT_LINKS.github)}`);
  console.log(`${chalk.bold('  LinkedIn: ')}${chalk.cyan(PROJECT_LINKS.linkedin)}`);
  console.log(`${chalk.bold('  Email:    ')}${chalk.cyan(PROJECT_LINKS.email)}`);
}

// ── Capability state ──────────────────────────────────────────────────────────

let _ragReady = false;
let _setupReady = false;

async function loadCapState(cwd: string): Promise<void> {
  try {
    const { detectRagTrainingStatus, isProjectPrepared } = await import('../infra/setup/project-setup.js');
    const status = detectRagTrainingStatus(cwd);
    _ragReady = status.semanticVectorsReady;
    _setupReady = isProjectPrepared(cwd);
  } catch { /* best-effort */ }
}

// ── Stale index detection ─────────────────────────────────────────────────────

function checkIndexStaleness(root: string): string | null {
  try {
    const idxPath = join(root, AI_RUNTIME_DIR, 'repo-index.json');
    if (!existsSync(idxPath)) return null;
    const idxMtime = statSync(idxPath).mtimeMs;
    const srcDir = join(root, 'src');
    const base = existsSync(srcDir) ? srcDir : root;
    let changed = 0;
    const walk = (dir: string, depth = 0) => {
      if (depth > 4) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (isIgnoredDirName(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full, depth + 1); continue; }
        if (!/\.(ts|tsx|js|jsx|py|go|rb|rs|java)$/.test(entry.name)) continue;
        if (statSync(full).mtimeMs > idxMtime) changed++;
      }
    };
    walk(base);
    if (changed === 0) return null;
    const mins = Math.round((Date.now() - idxMtime) / 60000);
    const ago = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
    return chalk.yellow(`⚠ Index is stale by ${ago} (${changed} modified file${changed > 1 ? 's' : ''}) — run ${chalk.bold('aion index')}`);
  } catch { return null; }
}

// ── Fallback (non-TTY) ────────────────────────────────────────────────────────

export function runMenuFallback(cwd: string): void {
  const projectName = displayProjectName(cwd);
  console.log('');
  console.log(chalk.bold.cyan(`  🤖 aion — ${projectName}`));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  console.log(chalk.dim('  Run in an interactive terminal to access the menu.'));
  console.log('');
  console.log(chalk.bold('  Zero token:  ') + chalk.cyan('aion health  · aion scan seo  · aion scan secrets  · aion scan env-audit  · aion report'));
  console.log(chalk.bold('  Uses AI:     ') + chalk.cyan('aion audit . --budget normal  · aion fix <file>  · aion analyze "<problem>"  · aion chat'));
  console.log(chalk.bold('  Links:       ') + chalk.cyan(`${PROJECT_LINKS.github}  ·  ${PROJECT_LINKS.linkedin}  ·  ${PROJECT_LINKS.email}`));
  console.log(chalk.bold('  Guided:      ') + chalk.cyan('aion menu'));
  console.log('');
}

// ── Main menu items ───────────────────────────────────────────────────────────

function buildMainItems(provider: string): Array<MenuItem<MenuAction>> {
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
    { label: 'System', header: true, value: 'sep' },
    { label: '🩺 Doctor',     hint: 'zero token · check all system components', description: 'Runs a full system health check: API keys, index freshness, provider connectivity, and tool availability.', value: 'doctor',    key: 'o' },
    { label: '🔌 Providers',  hint: 'zero token · show AI provider status',     description: 'Lists all configured AI providers, shows which is active, and reports API key status for each.', value: 'providers' },
    { label: '', value: 'sep', separator: true },
    { label: `⚙️  Provider: ${chalk.cyan(provider)}`, hint: 'change AI provider', value: 'change-provider' },
    { label: '  Quit', value: 'quit', key: 'q' },
  ];
}

export const MAIN_ITEMS: Array<MenuItem<MenuAction>> = buildMainItems('claude');

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function runMenu(cwd: string): Promise<void> {
  if (!process.stdin.isTTY) { runMenuFallback(cwd); return; }

  const { loadAionConfig } = await import('../infra/aion-config.js');
  const aionConfig = loadAionConfig(cwd);
  const menuPrefs = loadMenuPrefs(cwd);
  let currentProvider: string = menuPrefs.provider ?? aionConfig.provider ?? 'claude';

  const projectName = displayProjectName(cwd);
  let info = projectName;
  try {
    const { GraphAgent } = await import('../agents/graph-agent.js');
    const index = new GraphAgent(cwd).getIndex();
    if (index) info += ` · ${index.stats.files} files`;
  } catch { /* best-effort */ }

  try {
    const { existsSync: fsExists, readFileSync } = await import('fs');
    const historyFile = join(cwd, AI_RUNTIME_DIR, 'reports', 'audit-history.json');
    if (fsExists(historyFile)) {
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

  await loadCapState(cwd);

  // Health score from trend history
  let healthScore: string | null = null;
  try {
    const { loadTrend } = await import('../infra/audit-trend.js');
    const trend = loadTrend(cwd);
    const last = trend.entries.at(-1);
    if (last) {
      const prev = trend.entries.at(-2);
      const delta = prev ? last.score - prev.score : 0;
      const arrow = delta > 2 ? chalk.green('↑') : delta < -2 ? chalk.red('↓') : chalk.dim('→');
      const scoreColor = last.score >= 80 ? chalk.green : last.score >= 60 ? chalk.yellow : chalk.red;
      healthScore = `health ${scoreColor(`${last.score}/100`)} ${arrow}`;
    }
  } catch { /* best-effort */ }

  const staleWarning = checkIndexStaleness(cwd);

  function buildStatusLine(): string {
    const rag = _ragReady ? chalk.green('RAG ready') : chalk.dim('RAG optional');
    const setup = _setupReady ? chalk.green('setup ok') : chalk.dim('initial setup pending');
    const lf = `LangFuse ${currentLangfuseLabel()}`;
    const prov = `provider: ${chalk.cyan(currentProvider)}`;
    const health = healthScore ? `  ${healthScore}` : '';
    return `  ${setup}   ${rag}   ${lf}   ${prov}${health}`;
  }

  while (true) {
    console.log('');
    printHeader(projectName, info);
    console.log(buildStatusLine());
    if (!_setupReady) {
      console.log(chalk.yellow('  ⚡ First time? Run `aion setup` to index your codebase, build memory, and install the git hook.'));
    }
    if (staleWarning) console.log(`  ${staleWarning}`);

    const action = await selectOne('What do you want to do?', buildMainItems(currentProvider));
    if (!action || action === 'quit') break;
    if (action === 'sep') continue;

    if (action === 'local-check') {
      run(['--cwd', cwd, 'report', '--diagnostics']);
      await pressAnyKey();
      continue;
    }

    if (action === 'seo') {
      run(['--cwd', cwd, 'scan', 'seo']);
      await pressAnyKey();
      continue;
    }

    if (action === 'network-scan') {
      run(['--cwd', cwd, 'scan', 'network']);
      await pressAnyKey();
      continue;
    }

    if (action === 'app-security') {
      run(['--cwd', cwd, 'scan', 'security']);
      await pressAnyKey();
      continue;
    }

    if (action === 'bugs') {
      const mode = await chooseAuditMode(cwd, 'bugs');
      if (mode) runAuditTrack(cwd, 'bugs', mode, currentProvider);
      await pressAnyKey();
      continue;
    }

    if (action === 'security') {
      const mode = await chooseAuditMode(cwd, 'security');
      if (mode) runAuditTrack(cwd, 'security', mode, currentProvider);
      await pressAnyKey();
      continue;
    }

    if (action === 'perf') {
      const mode = await chooseAuditMode(cwd, 'perf');
      if (mode) runAuditTrack(cwd, 'perf', mode, currentProvider);
      await pressAnyKey();
      continue;
    }

    if (action === 'fix') {
      const file = await promptLine('File to fix (relative path)');
      if (file) {
        const args = ['--cwd', cwd, 'fix', file];
        if (currentProvider !== 'claude') args.push('--provider', currentProvider);
        run(args);
        await pressAnyKey();
      }
      continue;
    }

    if (action === 'analyze') {
      const target = await promptLine('Describe the problem');
      if (target) {
        const args = ['--cwd', cwd, 'analyze', target];
        if (currentProvider !== 'claude') args.push('--provider', currentProvider);
        run(args);
        await pressAnyKey();
      }
      continue;
    }

    if (action === 'change-provider') {
      const picked = await selectOne('Select AI provider', PROVIDER_ITEMS);
      if (picked) {
        currentProvider = picked;
        saveMenuPrefs(cwd, { provider: picked });
      }
      continue;
    }

    if (action === 'assistant') {
      const { runInteractive } = await import('./interactive.js');
      await runInteractive(cwd);
      continue;
    }

    if (action === 'chat-qa') {
      run(['--cwd', cwd, 'chat']);
      continue;
    }

    if (action === 'report') {
      run(['--cwd', cwd, 'report']);
      await pressAnyKey();
      continue;
    }

    if (action === 'links') {
      showProjectLinks();
      await pressAnyKey();
      continue;
    }

    if (action === 'copilot') {
      run(['--cwd', cwd, 'copilot', 'safe', '--dry-run']);
      await pressAnyKey();
      continue;
    }

    if (action === 'doctor') {
      run(['--cwd', cwd, 'doctor']);
      await pressAnyKey();
      continue;
    }

    if (action === 'providers') {
      run(['--cwd', cwd, 'providers']);
      await pressAnyKey();
      continue;
    }
  }

  console.log(chalk.dim('\nBye!\n'));
}
