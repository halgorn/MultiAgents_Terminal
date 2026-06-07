import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { selectOne, printHeader } from './tui.js';
import type { MenuItem } from './tui.js';

// ── Kept for external consumers (audit command, tests) ────────────────────────
export type { MenuItem };
export const ALL_DOMAINS = [
  { label: 'security',       hint: 'pentester buscando vetores de ataque',                       value: 'security' },
  { label: 'bugs',           hint: 'QA caçando falhas lógicas e null dereferences',              value: 'bugs' },
  { label: 'redundancy',     hint: 'arquiteto eliminando código morto e duplicado',              value: 'redundancy' },
  { label: 'error-handling', hint: 'SRE encontrando pontos de falha silenciosa',                 value: 'error-handling' },
  { label: 'architecture',   hint: 'tech lead avaliando acoplamento e dívida técnica',           value: 'architecture' },
  { label: 'testing',        hint: 'QA mapeando lacunas de cobertura de testes',                 value: 'testing' },
  { label: 'performance',    hint: 'engenheiro caçando gargalos de plataforma',                  value: 'performance' },
  { label: 'infrastructure', hint: 'DevOps revisando K8s e containers',                          value: 'infrastructure' },
  { label: 'observability',  hint: 'SRE verificando logs, traces e métricas',                    value: 'observability' },
  { label: 'resilience',     hint: 'eng de confiabilidade: timeouts, retries, circuit breakers', value: 'resilience' },
  { label: 'data',           hint: 'DBA encontrando N+1 queries e índices faltando',             value: 'data' },
  { label: 'dependencies',   hint: 'segurança em supply chain e CVEs',                           value: 'dependencies' },
  { label: 'compliance',     hint: 'DPO verificando conformidade LGPD/GDPR',                     value: 'compliance' },
  { label: 'multitenancy',   hint: 'arquiteto verificando isolamento de tenants',                value: 'multitenancy' },
  { label: 'prompt-audit',   hint: 'eng de IA auditando prompts LLM e injeção',                 value: 'prompt-audit' },
];

export const PRESETS = [
  { label: '🔐 Security', value: 'security' },
  { label: '⚙️  Backend',  value: 'backend' },
  { label: '🛠️  DevOps',   value: 'devops' },
  { label: '✨ Quality',  value: 'quality' },
  { label: '🌍 Full',    value: 'full' },
];

export const BUDGETS = [
  { label: 'low',    hint: 'rápido e barato  · est. $0.10–0.50', value: 'low' },
  { label: 'normal', hint: 'balanceado       · est. $0.50–2.00', value: 'normal' },
  { label: 'deep',   hint: 'completo         · est. $2.00–5.00', value: 'deep' },
];

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
  console.log(chalk.dim(`\n  ⏳ aion ${displayArgs.join(' ')}  (Ctrl+C para cancelar)\n`));
  const onSigint = () => { /* intentional: let child handle it, menu survives */ };
  process.on('SIGINT', onSigint);
  const result = spawnSync(process.execPath, [process.argv[1]!, ...args], {
    stdio: 'inherit', env: process.env,
  });
  process.removeListener('SIGINT', onSigint);
  resetTty();
  drainStdin();
  if (result.error) console.error(chalk.red(result.error.message));
}

async function pressEnter(): Promise<void> {
  resetTty();
  drainStdin();
  return new Promise<void>((resolve) => {
    process.stdout.write(chalk.dim('\n  ──────────────────────────────────────────────────\n'));
    process.stdout.write('  ' + chalk.bold('↵  Pressione Enter para voltar ao menu'));
    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      process.stdin.removeListener('data', onData);
      process.removeListener('SIGINT', onSigint);
      process.stdout.write('\n');
      drainStdin();
      resolve();
    };
    const onData = cleanup;
    const onSigint = cleanup;
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
    const idxPath = join(root, '.ai-runtime', 'repo-index.json');
    if (!existsSync(idxPath)) return null;
    const idxMtime = statSync(idxPath).mtimeMs;
    const srcDir = join(root, 'src');
    const base = existsSync(srcDir) ? srcDir : root;
    let changed = 0;
    const walk = (dir: string, depth = 0) => {
      if (depth > 4) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', 'build', '.git', '.ai-runtime'].includes(entry.name)) continue;
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
    return chalk.yellow(`⚠ Índice desatualizado há ${ago} (${changed} arquivo${changed > 1 ? 's' : ''} modificado${changed > 1 ? 's' : ''}) — execute ${chalk.bold('aion index')}`);
  } catch { return null; }
}

// ── Fallback (non-TTY) ────────────────────────────────────────────────────────

export function runMenuFallback(cwd: string): void {
  const projectName = cwd.split('/').pop() ?? cwd;
  console.log('');
  console.log(chalk.bold.cyan(`  🤖 aion — ${projectName}`));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  console.log(chalk.dim('  Execute em um terminal interativo para acessar o menu.'));
  console.log('');
  console.log(chalk.bold('  Diagnóstico: ') + chalk.cyan('aion health  · aion scan secrets  · aion report'));
  console.log(chalk.bold('  Audit:       ') + chalk.cyan('aion audit . --domains security  · aion audit . --preset quality'));
  console.log(chalk.bold('  IA:          ') + chalk.cyan('aion fix <arquivo>  · aion analyze "<problema>"  · aion chat'));
  console.log(chalk.bold('  Setup:       ') + chalk.cyan('aion setup  · aion memory build  · aion index'));
  console.log('');
}

// ── Main menu items ───────────────────────────────────────────────────────────

export const MAIN_ITEMS: Array<MenuItem<string>> = [
  { label: '🐛 Bugs & Qualidade',    hint: 'audit: bugs, error-handling, architecture, testing', value: 'bugs' },
  { label: '🔐 Segurança',           hint: 'audit: security, compliance, dependencies',           value: 'security' },
  { label: '⚡ Performance & Infra', hint: 'audit: performance, observability, resilience',       value: 'perf' },
  { label: '🔧 Corrigir arquivo',    hint: 'pede caminho → aion fix',                             value: 'fix' },
  { label: '🔍 Analisar problema',   hint: 'pede descrição → aion analyze',                       value: 'analyze' },
  { label: '💬 Chat sobre o repo',   hint: 'modo interativo em linguagem natural',                value: 'chat' },
  { label: '📊 Health check',        hint: 'sem IA, zero custo',                                  value: 'health' },
  { label: '⚙️  Setup',              hint: 'wizard inicial: config, índices e RAG',               value: 'setup' },
  { label: '', value: 'sep', separator: true },
  { label: '  Sair', value: 'quit' },
];

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
    const { existsSync: fsExists, readFileSync } = await import('fs');
    const historyFile = join(cwd, '.ai-runtime', 'reports', 'audit-history.json');
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

  const staleWarning = checkIndexStaleness(cwd);

  function buildStatusLine(): string {
    const rag = _ragReady ? chalk.green('✓ RAG') : chalk.yellow('⚠ RAG não treinado');
    const setup = _setupReady ? chalk.green('✓ Setup') : chalk.dim('○ Setup pendente');
    return `  ${setup}   ${rag}`;
  }

  while (true) {
    console.log('');
    printHeader(cwd.split('/').pop() ?? cwd, info);
    console.log(buildStatusLine());
    if (staleWarning) console.log(`  ${staleWarning}`);

    const action = await selectOne('O que você quer fazer?', MAIN_ITEMS);
    if (!action || action === 'quit') break;
    if (action === 'sep' || action === '') continue;

    if (action === 'bugs') {
      run(['--cwd', cwd, 'audit', '.', '--domains', 'bugs,error-handling,architecture,testing', '--force-full']);
      await pressEnter();
      continue;
    }

    if (action === 'security') {
      run(['--cwd', cwd, 'audit', '.', '--domains', 'security,compliance,dependencies', '--force-full']);
      await pressEnter();
      continue;
    }

    if (action === 'perf') {
      run(['--cwd', cwd, 'audit', '.', '--domains', 'performance,observability,resilience', '--force-full']);
      await pressEnter();
      continue;
    }

    if (action === 'fix') {
      const file = await promptLine('Arquivo para corrigir (caminho relativo)');
      if (file) { run(['--cwd', cwd, 'fix', file]); await pressEnter(); }
      continue;
    }

    if (action === 'analyze') {
      const target = await promptLine('Descreva o problema');
      if (target) { run(['--cwd', cwd, 'analyze', target]); await pressEnter(); }
      continue;
    }

    if (action === 'chat') {
      const { runInteractive } = await import('./interactive.js');
      await runInteractive(cwd);
      continue;
    }

    if (action === 'health') {
      run(['--cwd', cwd, 'health']);
      await pressEnter();
      continue;
    }

    if (action === 'setup') {
      run(['--cwd', cwd, 'setup']);
      await pressEnter();
      await loadCapState(cwd);
      continue;
    }
  }

  console.log(chalk.dim('\nBye!\n'));
}
