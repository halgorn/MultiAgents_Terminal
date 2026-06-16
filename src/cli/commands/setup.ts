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
import { AION_CONFIG_FILE } from '../../infra/paths.js';

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

function runSelfCommandWithEnv(cwd: string, args: string[], env: NodeJS.ProcessEnv): boolean {
  const result = spawnSync(process.execPath, [process.argv[1]!, '--cwd', cwd, ...args], {
    stdio: 'inherit',
    env,
  });
  return (result.status ?? 1) === 0;
}

function runSelfCommand(cwd: string, args: string[]): boolean {
  return runSelfCommandWithEnv(cwd, args, process.env);
}

function runMemoryBuildWithFallback(cwd: string): boolean {
  const firstAttempt = runSelfCommand(cwd, ['memory', 'build']);
  if (firstAttempt) return true;

  const hadRemoteEmbeddingEnv = Boolean(process.env['OPENAI_API_KEY'] || process.env['VOYAGE_API_KEY']);
  if (!hadRemoteEmbeddingEnv) return false;

  process.stdout.write(
    chalk.yellow('\nRemote embeddings failed. Retrying with local fallback (hash-384d, no API key required)...\n'),
  );
  const fallbackEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OPENAI_API_KEY: '',
    VOYAGE_API_KEY: '',
  };
  return runSelfCommandWithEnv(cwd, ['memory', 'build'], fallbackEnv);
}

async function chooseBudget(): Promise<'low' | 'normal' | 'deep'> {
  const picked = await selectOne('Default analysis budget', [
    { label: 'low',    hint: 'fast and cheap  · minimal token usage', value: 'low' },
    { label: 'normal', hint: 'balanced        · moderate coverage',   value: 'normal' },
    { label: 'deep',   hint: 'thorough        · extended analysis',   value: 'deep' },
  ]);
  return parseBudget(picked ?? 'low');
}

async function chooseDomain(): Promise<string> {
  const picked = await selectOne('Default audit domain', [
    { label: 'bugs',     hint: 'good general-purpose starting point', value: 'bugs' },
    { label: 'security', hint: 'prioritize risks and hardening',      value: 'security' },
  ]);
  return picked ?? 'bugs';
}

function printStatus(cwd: string, json: boolean): void {
  const state = readSetupState(cwd);
  const prepared = isProjectPrepared(cwd);
  const rag = detectRagTrainingStatus(cwd);

  if (json) {
    process.stdout.write(JSON.stringify({ prepared, state: state ?? null }, null, 2) + '\n');
    return;
  }

  const ok = chalk.green('✓');
  const no = chalk.red('✗');

  console.log(chalk.bold.cyan('\nSetup Status\n'));
  console.log(`  ${prepared ? ok : no}  Project prepared`);
  if (state) {
    const p = state.progress;
    console.log(`  ${p.configReady      ? ok : no}  Config ready`);
    console.log(`  ${p.localIndexReady  ? ok : no}  Repo index`);
    console.log(`  ${p.dependencyMapReady ? ok : no}  Dependency map`);
    console.log(`  ${p.semanticRagReady ? ok : no}  Semantic memory`);
    console.log(`  ${rag.repoIndexReady ? ok : no}  RAG index`);
    console.log(`  ${isHookInstalled(cwd) ? ok : no}  Git hook (post-commit)`);
    console.log('');
    console.log(`  domain:   ${chalk.cyan(state.selectedDomain ?? '—')}`);
    console.log(`  budget:   ${chalk.cyan(state.selectedBudget ?? '—')}`);
    console.log(`  scanners: ${chalk.cyan(String(state.selectedScanners ?? '—'))}`);
  } else {
    console.log(chalk.dim('\n  No setup state found. Run `aion setup` to initialize.'));
  }
  console.log('');
}

export async function runProjectSetupWizard(cwd: string, options: SetupRunOptions = {}): Promise<SetupWizardResult> {
  if (process.stdin.isTTY) {
    console.log(chalk.bold.cyan('\n  🤖 Aion Setup Wizard\n'));
  }
  const budget = options.budget ?? (process.stdin.isTTY ? await chooseBudget() : 'low');
  const domain = options.domain ?? (process.stdin.isTTY ? await chooseDomain() : 'bugs');
  const scanners = Math.max(1, Math.min(2, options.scanners ?? (budget === 'normal' ? 2 : 1)));
  const preSetupRagStatus = detectRagTrainingStatus(cwd);

  const hadConfig = existsSync(join(cwd, AION_CONFIG_FILE));
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
    .option('--json', 'output status as JSON (use with --status)')
    .option('--reset', 'reset setup state and exit')
    .option('--domain <domain>', 'default audit domain (e.g. bugs, security)')
    .option('--budget <budget>', 'default budget: low | normal | deep')
    .option('--scanners <n>', 'default scanner count (capped at 2 for onboarding)')
    .option('--semantic-rag', 'build semantic embeddings during setup (may use remote API)')
    .option('--skip-semantic-rag', 'skip semantic embeddings step')
    .action(async (options: {
      status?: boolean;
      json?: boolean;
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
        console.log('Setup state reset.');
        return;
      }

      if (options.status) {
        printStatus(cwd, options.json ?? false);
        return;
      }

      const scanners = options.scanners ? Number.parseInt(options.scanners, 10) : undefined;
      const result = await runProjectSetupWizard(cwd, {
        budget: parseBudget(options.budget ?? 'low'),
        domain: options.domain,
        scanners: Number.isFinite(scanners) ? scanners : undefined,
        semanticRag: options.semanticRag,
        skipSemanticRag: options.skipSemanticRag,
      });

      const ok = chalk.green('✓');
      const skip = chalk.dim('–');
      const hookOk = isHookInstalled(cwd);

      console.log(chalk.bold.green('\nSetup complete.\n'));
      console.log(`  ${ok}  Config:         ${chalk.dim(result.setupFile)}`);
      console.log(`  ${ok}  Repo index:     ready`);
      console.log(`  ${ok}  Dependency map: ready`);
      console.log(`  ${result.semanticRagBuilt ? ok : skip}  Semantic memory: ${result.semanticRagBuilt ? 'built' : 'skipped'}`);
      console.log(`  ${hookOk ? ok : skip}  Git hook:        ${hookOk ? 'installed (.git/hooks/post-commit)' : 'not installed (no .git)'}`);
      console.log('');
      console.log(`  Defaults → domain: ${chalk.cyan(result.domain)}  budget: ${chalk.cyan(result.budget)}  scanners: ${chalk.cyan(String(result.scanners))}`);

      if (!result.semanticRagBuilt) {
        console.log(chalk.dim('\n  Tip: run `aion memory build` later to enable semantic retrieval.'));
      }

      console.log('');
      console.log(chalk.bold('Next step:'));
      console.log(`  ${chalk.cyan('aion next')}  ${chalk.dim('— see recommended analysis flow for this project')}`);
      console.log('');
    });
}
