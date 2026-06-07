import type { Command } from 'commander';
import { spawnSync } from 'child_process';
import chalk from 'chalk';

type WorkflowName = 'quick' | 'safe' | 'release';

interface CopilotOptions {
  dryRun?: boolean;
}

interface WorkflowSpec {
  title: string;
  description: string;
  steps: string[][];
}

const WORKFLOWS: Record<WorkflowName, WorkflowSpec> = {
  quick: {
    title: 'Quick Guard',
    description: 'Fast zero-token checks for large repos.',
    steps: [
      ['health'],
      ['scan', 'secrets'],
      ['docs', 'analyze'],
      ['ci', '.', '--dry-run'],
    ],
  },
  safe: {
    title: 'Safe AI Guard',
    description: 'Quick guard + focused AI validation with bounded scope.',
    steps: [
      ['health'],
      ['scan', 'secrets'],
      ['docs', 'analyze'],
      ['audit', '.', '--domains', 'security,bugs', '--scanners', '2', '--max-files', '30', '--budget', 'low'],
      ['report'],
    ],
  },
  release: {
    title: 'Release Guard',
    description: 'Pre-release workflow with local and AI validations.',
    steps: [
      ['ci', '.', '--local-only', '--format', 'text'],
      ['audit', '.', '--domains', 'security,bugs,architecture', '--scanners', '2', '--max-files', '50', '--budget', 'normal'],
      ['report'],
    ],
  },
};

function runStep(cwd: string, args: string[]): number {
  const res = spawnSync(process.execPath, [process.argv[1]!, '--cwd', cwd, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  return res.status ?? 1;
}

export function registerCopilot(program: Command): void {
  const copilot = program
    .command('copilot')
    .description('Agent copilot workflows for safe validation and delivery');

  copilot
    .command('quick')
    .description(WORKFLOWS.quick.description)
    .option('--dry-run', 'print steps without executing')
    .action((options: CopilotOptions) => runWorkflow('quick', options));

  copilot
    .command('safe')
    .description(WORKFLOWS.safe.description)
    .option('--dry-run', 'print steps without executing')
    .action((options: CopilotOptions) => runWorkflow('safe', options));

  copilot
    .command('release')
    .description(WORKFLOWS.release.description)
    .option('--dry-run', 'print steps without executing')
    .action((options: CopilotOptions) => runWorkflow('release', options));
}

function runWorkflow(name: WorkflowName, options: CopilotOptions): void {
  const spec = WORKFLOWS[name];
  process.stdout.write(chalk.bold.cyan(`\nCopilot workflow: ${spec.title}\n`));
  process.stdout.write(chalk.gray(`  ${spec.description}\n\n`));
  process.stdout.write(chalk.bold('Steps:\n'));
  spec.steps.forEach((step, idx) => process.stdout.write(`  ${idx + 1}. aion ${step.join(' ')}\n`));
  process.stdout.write('\n');

  if (options.dryRun) {
    process.stdout.write('Dry-run only.\n');
    return;
  }

  const cwd = process.cwd();
  for (let i = 0; i < spec.steps.length; i++) {
    const step = spec.steps[i]!;
    process.stdout.write(chalk.cyan(`\n[${i + 1}/${spec.steps.length}] aion ${step.join(' ')}\n`));
    const code = runStep(cwd, step);
    if (code !== 0) {
      process.stderr.write(chalk.red(`\nWorkflow stopped at step ${i + 1} with exit code ${code}.\n`));
      process.exit(code);
    }
  }

  process.stdout.write(chalk.green('\nWorkflow complete.\n'));
}
