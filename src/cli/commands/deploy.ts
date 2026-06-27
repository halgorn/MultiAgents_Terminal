import type { Command } from 'commander';
import chalk from 'chalk';
import { buildAssistPlan, loadAssistPlan, saveAssistPlan, validateAssistPlan } from '../../infra/assist/assist-plan.js';
import { applyArtifacts, formatArtifactSummary } from '../../infra/assist/apply-artifacts.js';
import { executeRemotePlan, runHealthcheck } from '../../infra/assist/remote-executor.js';
import { generateAiAssistPlan } from '../../infra/assist/ai-generator.js';
import type { AssistProvider } from '../../infra/assist/types.js';

interface PlanOptions {
  json?: boolean;
  domain?: string;
  port?: string;
  deployPath?: string;
  provider?: AssistProvider;
}

function parsePort(value?: string): number | undefined {
  if (!value) return undefined;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function printPlan(path: string, plan: { artifacts: unknown[]; remoteSteps: unknown[]; requiredSecrets: string[]; healthcheckUrl: string }): void {
  console.log(chalk.green(`Assist plan: ${path}`));
  console.log(`  artifacts: ${plan.artifacts.length}`);
  console.log(`  remote steps: ${plan.remoteSteps.length}`);
  console.log(`  healthcheck: ${plan.healthcheckUrl}`);
  console.log(`  secrets: ${plan.requiredSecrets.join(', ')}`);
}

export function registerDeploy(program: Command): void {
  const deploy = program
    .command('deploy')
    .description('[DEPRECATED] CI/deploy planning, SSH dry-runs, and healthchecks');

  deploy
    .command('plan')
    .description('Detect project and write .ai-runtime/assist/deploy-plan.json')
    .option('--json', 'print plan as JSON')
    .option('--domain <domain>', 'deployment domain')
    .option('--port <port>', 'application port')
    .option('--deploy-path <path>', 'remote deployment path')
    .action((options: PlanOptions) => {
      const plan = buildAssistPlan(process.cwd(), {
        mode: 'full',
        provider: options.provider ?? 'claude',
        domain: options.domain,
        appPort: parsePort(options.port),
        deployPath: options.deployPath,
      });
      const errors = validateAssistPlan(plan);
      if (errors.length > 0) {
        console.error(chalk.red(errors.join('\n')));
        process.exit(1);
      }
      const path = saveAssistPlan(process.cwd(), plan);
      if (options.json) console.log(JSON.stringify(plan, null, 2));
      else printPlan(path, plan);
    });

  deploy
    .command('assist')
    .description('Generate assisted CI/deploy artifacts with deterministic templates or AI')
    .option('--dry-run', 'show planned writes only', true)
    .option('--apply', 'write generated artifacts')
    .option('--ai', 'ask configured provider to improve generated artifacts')
    .option('--provider <provider>', 'claude | codex | openrouter', 'claude')
    .option('--domain <domain>', 'deployment domain')
    .option('--port <port>', 'application port')
    .option('--deploy-path <path>', 'remote deployment path')
    .option('--overwrite', 'overwrite existing artifact files')
    .action(async (options: PlanOptions & { dryRun?: boolean; apply?: boolean; ai?: boolean; overwrite?: boolean }) => {
      let plan = buildAssistPlan(process.cwd(), {
        mode: 'full',
        provider: options.provider ?? 'claude',
        domain: options.domain,
        appPort: parsePort(options.port),
        deployPath: options.deployPath,
      });
      if (options.ai) {
        plan = await generateAiAssistPlan(plan, options.provider ?? 'claude', (chunk) => process.stderr.write(chunk));
      }
      const errors = validateAssistPlan(plan);
      if (errors.length > 0) {
        console.error(chalk.red(errors.join('\n')));
        process.exit(1);
      }
      const planPath = saveAssistPlan(process.cwd(), plan);
      const dryRun = !options.apply;
      const result = applyArtifacts(process.cwd(), plan, { dryRun, overwrite: options.overwrite });
      printPlan(planPath, plan);
      console.log(formatArtifactSummary(result));
      if (dryRun) console.log(chalk.gray('Dry-run only. Re-run with --apply to write files.'));
    });

  deploy
    .command('apply')
    .description('Apply a validated assist plan locally and optionally execute remote steps')
    .requiredOption('--plan <file>', 'path to assist plan JSON')
    .option('--dry-run', 'show SSH commands without executing remote steps', true)
    .option('--yes', 'execute remote steps when combined with --no-dry-run')
    .option('--overwrite', 'overwrite existing local artifact files')
    .action((options: { plan: string; dryRun?: boolean; yes?: boolean; overwrite?: boolean }) => {
      const plan = loadAssistPlan(options.plan);
      const errors = validateAssistPlan(plan);
      if (errors.length > 0) {
        console.error(chalk.red(errors.join('\n')));
        process.exit(1);
      }
      const applied = applyArtifacts(process.cwd(), plan, { dryRun: false, overwrite: options.overwrite });
      const remote = executeRemotePlan(plan, { dryRun: options.dryRun, yes: options.yes });
      console.log(formatArtifactSummary(applied));
      console.log(remote.output);
      process.exit(remote.ok ? 0 : 1);
    });

  deploy
    .command('check')
    .description('Run a curl healthcheck')
    .argument('[url]', 'healthcheck URL; defaults from saved assist plan')
    .option('--plan <file>', 'path to assist plan JSON')
    .action((url: string | undefined, options: { plan?: string }) => {
      const target = url ?? (options.plan ? loadAssistPlan(options.plan).healthcheckUrl : undefined);
      if (!target) {
        console.error(chalk.red('Provide a URL or --plan <file>.'));
        process.exit(1);
      }
      const result = runHealthcheck(target);
      if (result.output) console.log(result.output);
      process.exit(result.ok ? 0 : 1);
    });
}
