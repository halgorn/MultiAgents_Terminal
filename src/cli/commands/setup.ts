import type { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { selectOne } from '../tui.js';
import { buildRepoIndex, writeRepoIndex } from '../../infra/repo-index.js';
import { buildDepGraph, formatDepReport } from '../../infra/dep-graph.js';
import { KnowledgeStore } from '../../infra/knowledge.js';
import { loadAionConfig, writeAionConfig, writeDefaultConfig } from '../../infra/aion-config.js';
import {
  clearSetupState,
  createSetupState,
  detectRagTrainingStatus,
  isProjectPrepared,
  mergeSetupDefaultsIntoConfig,
  readSetupState,
  writeSetupState,
} from '../../infra/setup/project-setup.js';
import { installPostCommitHook, isHookInstalled } from '../../infra/git-hooks.js';
import { parseBudget } from '../cli-utils.js';

interface SetupRunOptions {
  budget?: 'low' | 'normal' | 'deep';
  domain?: string;
  scanners?: number;
  skipSemanticRag?: boolean;
  semanticRag?: boolean;
}

interface SetupWizardResult {
  setupFile: string;
  stateFile: string;
  budget: 'low' | 'normal' | 'deep';
  domain: string;
  scanners: number;
  semanticRagBuilt: boolean;
}

function runSelfCommand(cwd: string, args: string[]): boolean {
  const result = spawnSync(process.execPath, [process.argv[1]!, '--cwd', cwd, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  return (result.status ?? 1) === 0;
}

function runSelfCommandWithEnv(cwd: string, args: string[], env: NodeJS.ProcessEnv): boolean {
  const result = spawnSync(process.execPath, [process.argv[1]!, '--cwd', cwd, ...args], {
    stdio: 'inherit',
    env,
  });
  return (result.status ?? 1) === 0;
}

function runMemoryBuildWithFallback(cwd: string): boolean {
  const firstAttempt = runSelfCommand(cwd, ['memory', 'build']);
  if (firstAttempt) return true;

  const hadRemoteEmbeddingEnv = Boolean(process.env['OPENAI_API_KEY'] || process.env['VOYAGE_API_KEY']);
  if (!hadRemoteEmbeddingEnv) return false;

  process.stdout.write(
    chalk.yellow('\nEmbeddings remotos falharam. Tentando fallback local (hash-384d, sem API)...\n'),
  );
  const fallbackEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OPENAI_API_KEY: '',
    VOYAGE_API_KEY: '',
  };
  return runSelfCommandWithEnv(cwd, ['memory', 'build'], fallbackEnv);
}

async function chooseBudget(): Promise<'low' | 'normal' | 'deep'> {
  const picked = await selectOne('Budget padrão de análise', [
    { label: 'low', hint: 'mais barato: foco em velocidade', value: 'low' },
    { label: 'normal', hint: 'equilíbrio: cobertura moderada', value: 'normal' },
    { label: 'deep', hint: 'mais caro: análise extensa', value: 'deep' },
  ]);
  return parseBudget(picked ?? 'low');
}

async function chooseDomain(): Promise<string> {
  const picked = await selectOne('Domínio inicial de auditoria', [
    { label: 'bugs', hint: 'bom default geral para começar', value: 'bugs' },
    { label: 'security', hint: 'prioriza riscos e hardening', value: 'security' },
  ]);
  return picked ?? 'bugs';
}

export async function runProjectSetupWizard(cwd: string, options: SetupRunOptions = {}): Promise<SetupWizardResult> {
  const budget = options.budget ?? (process.stdin.isTTY ? await chooseBudget() : 'low');
  const domain = options.domain ?? (process.stdin.isTTY ? await chooseDomain() : 'bugs');
  const scanners = Math.max(1, Math.min(2, options.scanners ?? (budget === 'normal' ? 2 : 1)));
  const preSetupRagStatus = detectRagTrainingStatus(cwd);

  const hadConfig = existsSync(join(cwd, '.aionrc.json'));
  if (!hadConfig) writeDefaultConfig(cwd);
  const merged = mergeSetupDefaultsIntoConfig(loadAionConfig(cwd), { domain, budget, scanners });
  const setupFile = writeAionConfig(cwd, merged);

  const index = await buildRepoIndex(cwd);
  writeRepoIndex(cwd, index);

  const deps = buildDepGraph(cwd);
  const store = new KnowledgeStore(cwd);
  store.writeEntry('architecture', 'Dependency Graph', formatDepReport(deps));
  mkdirSync(join(cwd, '.ai-memory', 'architecture'), { recursive: true });
  writeFileSync(join(cwd, '.ai-memory', 'architecture', 'dep-graph.md'), formatDepReport(deps), 'utf8');

  // Always build semantic RAG unless already done or explicitly skipped.
  // FNV-1a hash fallback requires no API key — always safe to run.
  const shouldBuildSemanticRag = !preSetupRagStatus.semanticVectorsReady && !options.skipSemanticRag;

  let semanticRagBuilt = false;
  if (shouldBuildSemanticRag) {
    semanticRagBuilt = runMemoryBuildWithFallback(cwd);
  }

  const state = createSetupState(cwd, {
    progress: {
      configReady: true,
      localIndexReady: true,
      dependencyMapReady: true,
      semanticRagReady: semanticRagBuilt,
    },
    selectedDomain: domain,
    selectedBudget: budget,
    selectedScanners: scanners,
    skippedSemanticRag: !semanticRagBuilt,
  });
  const stateFile = writeSetupState(cwd, state);

  installPostCommitHook(cwd);

  return { setupFile, stateFile, budget, domain, scanners, semanticRagBuilt };
}

export function registerSetup(program: Command): void {
  program
    .command('setup')
    .description('Run initial project wizard (config, indexes, optional semantic RAG)')
    .option('--status', 'show setup status and exit')
    .option('--reset', 'reset setup state and exit')
    .option('--domain <domain>', 'default audit domain (e.g. bugs, security)')
    .option('--budget <budget>', 'default budget: low | normal | deep')
    .option('--scanners <n>', 'default scanner count (capped at 2 for onboarding)')
    .option('--semantic-rag', 'build semantic embeddings during setup (may use remote API)')
    .option('--skip-semantic-rag', 'skip semantic embeddings step')
    .action(async (options: {
      status?: boolean;
      reset?: boolean;
      domain?: string;
      budget?: 'low' | 'normal' | 'deep';
      scanners?: string;
      semanticRag?: boolean;
      skipSemanticRag?: boolean;
    }) => {
      const cwd = process.cwd();
      if (options.reset) {
        clearSetupState(cwd);
        process.stdout.write('Setup state reset.\n');
        return;
      }

      if (options.status) {
        const state = readSetupState(cwd);
        process.stdout.write(JSON.stringify({
          prepared: isProjectPrepared(cwd),
          state: state ?? null,
        }, null, 2) + '\n');
        return;
      }

      process.stdout.write(chalk.bold.cyan('\nAion project setup wizard\n'));
      const scanners = options.scanners ? Number.parseInt(options.scanners, 10) : undefined;
      const result = await runProjectSetupWizard(cwd, {
        budget: parseBudget(options.budget ?? 'low'),
        domain: options.domain,
        scanners: Number.isFinite(scanners) ? scanners : undefined,
        semanticRag: options.semanticRag,
        skipSemanticRag: options.skipSemanticRag,
      });

      process.stdout.write(chalk.green('\nSetup complete.\n'));
      process.stdout.write(`  config: ${result.setupFile}\n`);
      process.stdout.write(`  state: ${result.stateFile}\n`);
      process.stdout.write(`  defaults: domain=${result.domain}, budget=${result.budget}, scanners=${result.scanners}\n`);
      process.stdout.write(`  semantic rag: ${result.semanticRagBuilt ? 'built' : 'skipped'}\n`);
      process.stdout.write(`  git hook: ${isHookInstalled(cwd) ? 'instalado (.git/hooks/post-commit)' : 'não instalado (sem .git)'}\n`);
      if (!result.semanticRagBuilt) {
        process.stdout.write('  run `aion memory build` later to enable semantic retrieval.\n');
      }

      const rag = detectRagTrainingStatus(cwd);
      process.stdout.write(`  rag status: repo-index=${rag.repoIndexReady ? 'ok' : 'missing'}, vectors=${rag.semanticVectorsReady ? 'ok' : 'missing'}\n`);
    });
}
