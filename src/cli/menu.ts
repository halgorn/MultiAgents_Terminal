import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { selectOne, selectMany, printHeader } from './tui.js';
import type { MenuItem } from './tui.js';
import type { ScanDomain } from '../prompts/scanner.js';

// ── Data ──────────────────────────────────────────────────────────────────────

export const ALL_DOMAINS: Array<MenuItem<ScanDomain>> = [
  { label: 'security',       hint: 'pentester buscando vetores de ataque',                  value: 'security' },
  { label: 'bugs',           hint: 'QA caçando falhas lógicas e null dereferences',         value: 'bugs' },
  { label: 'redundancy',     hint: 'arquiteto eliminando código morto e duplicado',         value: 'redundancy' },
  { label: 'error-handling', hint: 'SRE encontrando pontos de falha silenciosa',            value: 'error-handling' },
  { label: 'architecture',   hint: 'tech lead avaliando acoplamento e dívida técnica',      value: 'architecture' },
  { label: 'testing',        hint: 'QA mapeando lacunas de cobertura de testes',            value: 'testing' },
  { label: 'performance',    hint: 'engenheiro caçando gargalos de plataforma',             value: 'performance' },
  { label: 'infrastructure', hint: 'DevOps revisando K8s e containers',                     value: 'infrastructure' },
  { label: 'observability',  hint: 'SRE verificando logs, traces e métricas',               value: 'observability' },
  { label: 'resilience',     hint: 'eng de confiabilidade: timeouts, retries, circuit breakers', value: 'resilience' },
  { label: 'data',           hint: 'DBA encontrando N+1 queries e índices faltando',        value: 'data' },
  { label: 'dependencies',   hint: 'segurança em supply chain e CVEs',                      value: 'dependencies' },
  { label: 'compliance',     hint: 'DPO verificando conformidade LGPD/GDPR',                value: 'compliance' },
  { label: 'multitenancy',   hint: 'arquiteto verificando isolamento de tenants',           value: 'multitenancy' },
  { label: 'prompt-audit',   hint: 'eng de IA auditando prompts LLM e injeção',            value: 'prompt-audit' },
];

export const PRESETS: Array<MenuItem<string>> = [
  { label: '🔐 Security',  hint: 'security, compliance, dependencies, multitenancy',              value: 'security' },
  { label: '🤖 AI/LLM',   hint: 'prompt-audit, security, resilience, observability, data',       value: 'ai' },
  { label: '⚙️  Backend',  hint: 'security, data, error-handling, resilience, performance',       value: 'backend' },
  { label: '🛠️  DevOps',   hint: 'infrastructure, observability, resilience, dependencies',       value: 'devops' },
  { label: '✨ Quality',   hint: 'bugs, architecture, testing, redundancy, error-handling',       value: 'quality' },
  { label: '🏢 SaaS',     hint: 'multitenancy, compliance, security, resilience, observability', value: 'saas' },
  { label: '🏦 FinTech',  hint: 'compliance, security, data, multitenancy, error-handling',      value: 'fintech' },
  { label: '🌍 Full',     hint: 'todos os 15 domínios (requer --force-full)',                    value: 'full' },
  { label: '📝 Custom…',  hint: 'selecione domínios individuais com Espaço',                     value: 'custom' },
  { label: '← Voltar',    value: 'back' },
];

export const BUDGETS: Array<MenuItem<string>> = [
  { label: 'low',    hint: 'rápido e barato  · est. $0.10–0.50', value: 'low' },
  { label: 'normal', hint: 'balanceado       · est. $0.50–2.00', value: 'normal' },
  { label: 'deep',   hint: 'completo         · est. $2.00–5.00', value: 'deep' },
];

// ── Human-first main menu ─────────────────────────────────────────────────────

export const MAIN_ITEMS: Array<MenuItem<string>> = [
  { label: 'Diagnóstico local',      hint: 'sem IA: saúde, scans e relatório',              value: 'model-local' },
  { label: 'IA — Copilot / Audit',   hint: 'workflows IA com ou sem RAG — adapta contexto', value: 'ia' },
  { label: 'Preparar / configurar',  hint: 'wizard inicial: setup, índices e RAG opcional',  value: 'setup' },
  { label: 'Publicar / operar',      hint: 'CI + deploy assistido, healthcheck e init',      value: 'publish' },
  { label: 'Avançado',               hint: 'cloud, MCP, eval, trace e personas completas',   value: 'advanced' },
  { label: '', value: 'sep', separator: true },
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
  { action: 'model-local', submenu: 'model-local', cost: 'zero-token',        recommendation: 'keep', note: 'Diagnóstico local: health, scan, tree, patterns, report.' },
  { action: 'ia',          submenu: 'ia',          cost: 'ai',                 recommendation: 'keep', note: 'IA unificada: adapta contexto ao RAG; avisa quando keyword-only.' },
  { action: 'setup',       command: ['setup'],      cost: 'local-side-effect', recommendation: 'keep', note: 'Wizard de onboarding: config, índices e RAG opcional.' },
  { action: 'publish',     submenu: 'publish',      cost: 'local-side-effect', recommendation: 'keep', note: 'CI + deploy assistido, healthcheck e init.' },
  { action: 'advanced',    submenu: 'advanced',     cost: 'external-service',  recommendation: 'keep', note: 'Audit com personas, cloud, MCP, eval, trace.' },
];

// ── Capability state cache (loaded once per runMenu call) ─────────────────────

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

  const displayArgs = args.filter((a, i) => a !== '--cwd' && args[i - 1] !== '--cwd');
  console.log(chalk.dim(`\n  ⏳ aion ${displayArgs.join(' ')}  (Ctrl+C para cancelar)\n`));

  // Swallow SIGINT in the menu process — the child shares the terminal's
  // foreground process group and receives SIGINT directly from the OS.
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
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    process.stdout.write(chalk.dim('\n  Pressione Enter para voltar ao menu...'));
    const cleanup = () => {
      rl.close();
      process.stdin.removeListener('data', onData);
      process.removeListener('SIGINT', onSigint);
      process.stdout.write('\n');
      resolve();
    };
    const onData = cleanup;
    const onSigint = cleanup;
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

async function offerNextAction(cwd: string): Promise<void> {
  const items: Array<MenuItem<string>> = [
    { label: 'Corrigir hotspot com IA', hint: 'fix, analyze ou review com IA', value: 'ai-help' },
    { label: 'Auditoria por categoria',  hint: 'segurança, bugs, arquitetura...', value: 'problems' },
  ];
  if (_ragReady) {
    items.push({ label: 'Busca semântica', hint: 'memory search no RAG indexado', value: 'memory-search' });
  }
  items.push({ label: '← Voltar', value: 'back' });

  const next = await selectOne('O que fazer agora?', items);
  if (!next || next === 'back') return;
  if (next === 'ai-help') { await runAiHelpMenu(cwd); return; }
  if (next === 'problems') { await runProblemsMenu(cwd); return; }
  if (next === 'memory-search') {
    const q = await promptLine('Busca');
    if (q) { run(['--cwd', cwd, 'memory', 'search', q]); await pressEnter(); }
  }
}

// ── Submenus ──────────────────────────────────────────────────────────────────

async function runAuditMenu(cwd: string): Promise<void> {
  const preset = await selectOne('Preset de personas', PRESETS, 'Cada preset é um time de personas de IA especializadas');
  if (!preset || preset === 'back') return;

  let domainArgs: string[];
  if (preset === 'custom') {
    const chosen = await selectMany('Selecionar personas', ALL_DOMAINS, 'Espaço para marcar, Enter para confirmar');
    if (!chosen || chosen.length === 0) return;
    domainArgs = ['--domains', chosen.join(',')];
  } else {
    domainArgs = ['--preset', preset];
  }

  const budget = await selectOne('Budget', BUDGETS);
  if (!budget) return;

  console.log(chalk.bold.cyan('\nIniciando auditoria…\n'));
  run(['--cwd', cwd, 'audit', '.', ...domainArgs, '--budget', budget]);
  await pressEnter();
}

async function runScanMenu(cwd: string): Promise<boolean> {
  const item = await selectOne('Tipo de scan', [
    { label: 'api-map',        hint: 'endpoints com status de auth/rate-limit',          value: 'api-map' },
    { label: 'env-audit',      hint: 'variáveis de ambiente documentadas vs não',        value: 'env-audit' },
    { label: 'cognitive-load', hint: 'aninhamento, números mágicos, funções longas',     value: 'cognitive-load' },
    { label: 'secrets',        hint: 'credenciais hardcoded no código-fonte',            value: 'secrets' },
    { label: 'sbom',           hint: 'lista de materiais de software + deps não fixadas', value: 'sbom' },
    { label: '← Voltar',      value: 'back' },
  ]);
  if (!item || item === 'back') return false;
  run(['--cwd', cwd, 'scan', item]);
  await pressEnter();
  return true;
}


async function runExplainMenu(cwd: string): Promise<void> {
  const mode = await selectOne('Explicar código', [
    { label: 'explain <arquivo>', hint: 'o que o arquivo faz e por que importa', value: 'explain' },
    { label: 'onboard',           hint: 'guia de onboarding para devs',          value: 'onboard' },
    { label: '← Voltar',         value: 'back' },
  ]);
  if (!mode || mode === 'back') return;

  if (mode === 'onboard') {
    run(['--cwd', cwd, 'onboard']);
    await pressEnter();
    return;
  }

  const file = await promptLine('Caminho do arquivo');
  if (!file) return;
  run(['--cwd', cwd, mode, file]);
  await pressEnter();
}


async function runCloudMenu(cwd: string): Promise<void> {
  const action = await selectOne('Cloud (somente leitura)', [
    { label: 'Status',   hint: 'provedores detectados e autenticados',             value: 'status' },
    { label: 'Analisar', hint: 'lê recursos cloud e identifica gaps do projeto',   value: 'analyze' },
    { label: 'Gaps',     hint: 'exibe apenas o relatório de gaps',                 value: 'gaps' },
    { label: '← Voltar', value: 'back' },
  ]);
  if (!action || action === 'back') return;
  run(['--cwd', cwd, 'cloud', action]);
  await pressEnter();
}

async function runMcpMenu(cwd: string): Promise<void> {
  const action = await selectOne('MCP Server', [
    { label: 'Listar tools', hint: 'exibe tools expostos ao Claude Desktop',       value: 'list-tools' },
    { label: 'Servir',       hint: 'inicia MCP server via stdio',                  value: 'serve' },
    { label: 'Registrar',    hint: 'registra em ~/.claude/mcp.json',               value: 'register' },
    { label: '← Voltar',    value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'register') { run(['--cwd', cwd, 'mcp', 'serve', '--register']); await pressEnter(); return; }
  run(['--cwd', cwd, 'mcp', action]);
  await pressEnter();
}

async function runEvalMenu(cwd: string): Promise<void> {
  const action = await selectOne('Avaliação RAG', [
    { label: 'Criar golden set',        hint: 'gera .ai-memory/eval/retrieval.json de exemplo', value: 'scaffold' },
    { label: 'Eval retrieval',          hint: 'mede recall@3/5 e MRR',                          value: 'retrieval' },
    { label: 'Eval retrieval + rerank', hint: 'mesmo com LLM re-ranking',                       value: 'retrieval-llm' },
    { label: '← Voltar',               value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'scaffold') { run(['--cwd', cwd, 'eval', 'retrieval', '--scaffold']); await pressEnter(); return; }
  if (action === 'retrieval-llm') { run(['--cwd', cwd, 'eval', 'retrieval', '--rerank', 'llm']); await pressEnter(); return; }
  run(['--cwd', cwd, 'eval', 'retrieval']);
  await pressEnter();
}


async function ensureRagReady(cwd: string, reason: string): Promise<boolean> {
  const { detectRagTrainingStatus } = await import('../infra/setup/project-setup.js');
  const status = detectRagTrainingStatus(cwd);
  if (status.semanticVectorsReady) return true;

  const action = await selectOne(`RAG obrigatório para ${reason}`, [
    { label: 'Rodar setup com RAG', hint: 'executa aion setup --semantic-rag', value: 'setup-rag' },
    { label: 'Rodar memory build', hint: 'executa aion memory build', value: 'memory-build' },
    { label: 'Cancelar', value: 'cancel' },
  ]);
  if (!action || action === 'cancel') return false;
  if (action === 'setup-rag') run(['--cwd', cwd, 'setup', '--semantic-rag']);
  if (action === 'memory-build') run(['--cwd', cwd, 'memory', 'build']);
  const after = detectRagTrainingStatus(cwd);
  if (!after.semanticVectorsReady) {
    console.log(chalk.yellow('\nRAG ainda não está pronto. Ação cancelada.\n'));
    await pressEnter();
    return false;
  }
  _ragReady = true;
  return true;
}

async function runModelLocalMenu(cwd: string): Promise<void> {
  const action = await selectOne('Diagnóstico local', [
    { label: 'Health score', hint: 'resumo local 0-100', value: 'health' },
    { label: 'Scan local', hint: 'api-map, env-audit, secrets, sbom', value: 'scan' },
    { label: 'Tree hotspots', hint: 'visão estrutural do projeto', value: 'tree' },
    { label: 'Docs analyze', hint: 'lacunas de documentação', value: 'docs-analyze' },
    { label: 'Patterns', hint: 'padrões arquiteturais locais', value: 'patterns' },
    { label: 'Report', hint: 'gera relatório local', value: 'report' },
    { label: '← Voltar', value: 'back' },
  ]);
  if (!action || action === 'back') return;
  let ran = false;
  if (action === 'scan') {
    ran = await runScanMenu(cwd);
  } else if (action === 'docs-analyze') {
    run(['--cwd', cwd, 'docs', 'analyze']); await pressEnter(); ran = true;
  } else {
    run(['--cwd', cwd, ...(DIRECT_COMMANDS[action] ?? [action])]); await pressEnter(); ran = true;
  }
  if (ran) await offerNextAction(cwd);
}

async function runIaMenu(cwd: string): Promise<void> {
  const ragNote = _ragReady ? '' : ' (keyword-only sem RAG)';
  const action = await selectOne('IA — Copilot / Audit', [
    { label: 'Copilot quick',              hint: 'workflow rápido de validação',                    value: 'copilot-quick' },
    { label: 'Copilot safe',               hint: 'workflow IA seguro (escopo controlado)',          value: 'copilot-safe' },
    { label: 'Copilot release',            hint: 'workflow pré-release',                           value: 'copilot-release' },
    { label: 'Auditoria por categoria',    hint: 'segurança, bugs, arquitetura...',                value: 'problems' },
    { label: `Corrigir / revisar${ragNote}`, hint: 'fix, analyze, review, explain, chat',         value: 'ai-help' },
    { label: 'Memory search (semântico)',  hint: _ragReady ? 'busca vetorial no projeto' : 'requer aion memory build', value: 'memory-search' },
    { label: '❯ Natural language',         hint: 'escreva um pedido em linguagem natural',         value: 'nl' },
    { label: '← Voltar',                   value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'problems') { await runProblemsMenu(cwd); return; }
  if (action === 'ai-help') { await runAiHelpMenu(cwd); return; }
  if (action === 'copilot-quick') { run(['--cwd', cwd, 'copilot', 'quick']); await pressEnter(); return; }
  if (action === 'copilot-safe') { run(['--cwd', cwd, 'copilot', 'safe']); await pressEnter(); return; }
  if (action === 'copilot-release') { run(['--cwd', cwd, 'copilot', 'release']); await pressEnter(); return; }
  if (action === 'memory-search') {
    const ready = await ensureRagReady(cwd, 'busca semântica');
    if (!ready) return;
    const q = await promptLine('Busca');
    if (q) { run(['--cwd', cwd, 'memory', 'search', q]); await pressEnter(); }
    return;
  }
  if (action === 'nl') {
    const { runInteractive } = await import('./interactive.js');
    await runInteractive(cwd);
  }
}


const AUDIT_DOMAIN_MAP: Record<string, string> = {
  'audit-security':      'security',
  'audit-bugs':          'bugs',
  'audit-architecture':  'architecture',
  'audit-performance':   'performance',
  'audit-observability': 'observability',
  'audit-dependencies':  'dependencies',
};

async function runProblemsMenu(cwd: string): Promise<void> {
  const action = await selectOne('Encontrar problemas', [
    { label: 'Segurança',       hint: 'pentester buscando vetores de ataque',          value: 'audit-security' },
    { label: 'Bugs',            hint: 'QA caçando falhas lógicas e null dereferences', value: 'audit-bugs' },
    { label: 'Arquitetura',     hint: 'tech lead avaliando acoplamento e dívida',      value: 'audit-architecture' },
    { label: 'Performance',     hint: 'engenheiro caçando gargalos',                   value: 'audit-performance' },
    { label: 'Observabilidade', hint: 'SRE verificando logs, traces e métricas',       value: 'audit-observability' },
    { label: 'Dependências',    hint: 'segurança em supply chain e CVEs',              value: 'audit-dependencies' },
    { label: 'Scan local',      hint: 'secrets, env, api-map, sbom (sem IA)',          value: 'scan' },
    { label: 'Report',          hint: 'relatório local em HTML/Markdown',              value: 'report' },
    { label: '← Voltar',        value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'scan') { await runScanMenu(cwd); return; }
  if (action === 'report') { run(['--cwd', cwd, ...(DIRECT_COMMANDS.report)]); await pressEnter(); return; }

  const domain = AUDIT_DOMAIN_MAP[action];
  if (domain) {
    const budget = await selectOne('Budget da auditoria', BUDGETS);
    if (!budget) return;
    console.log(chalk.bold.cyan('\nIniciando auditoria…\n'));
    run(['--cwd', cwd, 'audit', '.', '--domains', domain, '--scanners', '1', '--budget', budget]);
    await pressEnter();
  }
}


async function runAiHelpMenu(cwd: string): Promise<void> {
  if (!_ragReady) {
    console.log(chalk.yellow('\n  ⚠ RAG não treinado — contexto será keyword-only (qualidade reduzida)\n'));
  }
  const action = await selectOne('Corrigir ou revisar com IA', [
    { label: 'Fix',     hint: 'corrigir arquivo/bug com IA',      value: 'fix' },
    { label: 'Analyze', hint: 'investigar bug ou comportamento',  value: 'analyze' },
    { label: 'Review',  hint: 'revisar arquivo ou diff',          value: 'review' },
    { label: 'Explain', hint: 'explicar arquivo/onboarding',      value: 'explain' },
    { label: 'Chat',    hint: 'Q&A interativo sobre o repo',      value: 'chat' },
    { label: '← Voltar', value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'explain') { await runExplainMenu(cwd); return; }
  if (action === 'chat') { run(['--cwd', cwd, 'chat']); await pressEnter(); return; }
  if (action === 'fix') {
    const file = await promptLine('Arquivo para corrigir (caminho relativo)');
    if (file) { run(['--cwd', cwd, 'fix', file]); await pressEnter(); }
    return;
  }
  if (action === 'analyze') {
    const target = await promptLine('Descreva o bug ou problema');
    if (target) { run(['--cwd', cwd, 'analyze', target]); await pressEnter(); }
    return;
  }
  if (action === 'review') {
    const target = await promptLine('Arquivo ou diff para revisar');
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
    { label: '← Voltar',              value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'ci-assist') { run(['--cwd', cwd, 'ci', 'assist']); await pressEnter(); return; }
  if (action === 'deploy-plan') { run(['--cwd', cwd, 'deploy', 'plan']); await pressEnter(); return; }
  if (action === 'deploy-assist') { run(['--cwd', cwd, 'deploy', 'assist']); await pressEnter(); return; }
  if (action === 'deploy-apply') {
    const plan = await promptLine('Caminho do deploy-plan.json');
    if (plan) { run(['--cwd', cwd, 'deploy', 'apply', '--plan', plan]); await pressEnter(); }
    return;
  }
  if (action === 'deploy-check') {
    const url = await promptLine('URL do healthcheck');
    if (url) { run(['--cwd', cwd, 'deploy', 'check', url]); await pressEnter(); }
    return;
  }
  run(['--cwd', cwd, ...(DIRECT_COMMANDS[action] ?? [action])]);
  await pressEnter();
}

async function runAdvancedMenu(cwd: string): Promise<void> {
  const action = await selectOne('Avançado', [
    { label: 'Audit com personas', hint: 'seleção manual de preset/domínios', value: 'audit' },
    { label: 'Churn',              hint: 'histórico git e hotspots sociais',  value: 'churn' },
    { label: 'Diff',               hint: 'comparar relatórios de auditoria',  value: 'diff' },
    { label: 'Cloud',              hint: 'infra cloud somente leitura',        value: 'cloud' },
    { label: 'MCP',                hint: 'expor tools para Claude Desktop',   value: 'mcp' },
    { label: 'Eval RAG',           hint: 'medir recall@k e rerank do índice', value: 'eval' },
    { label: 'Status do RAG',      hint: 'estado do setup e índices',         value: 'rag-status' },
    { label: 'Trace',              hint: 'histórico de custo/latência',        value: 'trace' },
    { label: '← Voltar',           value: 'back' },
  ]);
  if (!action || action === 'back') return;
  if (action === 'audit') { await runAuditMenu(cwd); return; }
  if (action === 'cloud') { await runCloudMenu(cwd); return; }
  if (action === 'mcp') { await runMcpMenu(cwd); return; }
  if (action === 'eval') { await runEvalMenu(cwd); return; }
  if (action === 'rag-status') { run(['--cwd', cwd, 'setup', '--status']); await pressEnter(); return; }
  run(['--cwd', cwd, ...(DIRECT_COMMANDS[action] ?? [action])]);
  await pressEnter();
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
  console.log(chalk.bold('  IA:          ') + chalk.cyan('aion copilot quick  · aion copilot safe  · aion copilot release'));
  console.log(chalk.bold('  IA + RAG:    ') + chalk.cyan('aion setup --status  · aion memory build  · aion eval retrieval'));
  console.log(chalk.bold('  Setup:       ') + chalk.cyan('aion setup'));
  console.log(chalk.bold('  Operar:      ') + chalk.cyan('aion assist  · aion ci assist  · aion deploy assist  · aion trace'));
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

  await loadCapState(cwd);
  function buildStatusLine(): string {
    const rag = _ragReady ? chalk.green('✓ RAG') : chalk.yellow('⚠ RAG não treinado');
    const setup = _setupReady ? chalk.green('✓ Setup') : chalk.dim('○ Setup pendente');
    return `  ${setup}   ${rag}`;
  }

  while (true) {
    console.log('');
    printHeader(cwd.split('/').pop() ?? cwd, info);
    console.log(buildStatusLine());
    const action = await selectOne('O que você quer fazer?', MAIN_ITEMS);

    if (!action || action === 'quit') break;
    if (action === 'sep' || action === '') continue;

    if (action === 'model-local') { await runModelLocalMenu(cwd); continue; }
    if (action === 'ia')          { await runIaMenu(cwd); continue; }
    if (action === 'setup')       { run(['--cwd', cwd, 'setup']); await pressEnter(); await loadCapState(cwd); continue; }
    if (action === 'publish')     { await runPublishMenu(cwd); continue; }
    if (action === 'advanced')    { await runAdvancedMenu(cwd); continue; }
  }

  console.log(chalk.dim('\nBye!\n'));
}
