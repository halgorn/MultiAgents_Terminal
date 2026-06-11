import type { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { AI_RUNTIME_DIR } from '../../infra/paths.js';

const DEEPEVAL_SCRIPT = `from deepeval import assert_test
from deepeval.metrics import AnswerRelevancyMetric
from deepeval.test_case import LLMTestCase

test_case = LLMTestCase(
    input="Summarize this finding",
    actual_output="Critical auth check bypass in middleware. Fix by validating tenant + role before token trust.",
    expected_output="Critical authorization bypass in middleware; remediate by enforcing tenant and role verification before accepting token claims.",
)

metric = AnswerRelevancyMetric(threshold=0.5)
assert_test(test_case, [metric])
print("DeepEval quickcheck: passed")
`;

export function registerDeepEval(program: Command): void {
  const cmd = program
    .command('deepeval')
    .description('Manage DeepEval quick regression checks for portfolio and CI');

  cmd
    .command('init')
    .description('Create starter DeepEval test script and requirements file')
    .action(() => {
      const cwd = process.cwd();
      const dir = join(cwd, AI_RUNTIME_DIR, 'eval', 'deepeval');
      mkdirSync(dir, { recursive: true });
      const scriptPath = join(dir, 'quickcheck.py');
      const reqPath = join(dir, 'requirements.txt');
      if (!existsSync(scriptPath)) writeFileSync(scriptPath, DEEPEVAL_SCRIPT, 'utf8');
      if (!existsSync(reqPath)) writeFileSync(reqPath, 'deepeval>=1.4.0\n', 'utf8');
      console.log(chalk.green(`Created: ${scriptPath}`));
      console.log(chalk.green(`Created: ${reqPath}`));
      console.log(chalk.gray('Run: aion deepeval run'));
    });

  cmd
    .command('run')
    .description('Run DeepEval quickcheck via python3 if installed')
    .action(() => {
      const cwd = process.cwd();
      const scriptPath = join(cwd, AI_RUNTIME_DIR, 'eval', 'deepeval', 'quickcheck.py');
      if (!existsSync(scriptPath)) {
        console.log(chalk.yellow('DeepEval quickcheck is not initialized.'));
        console.log(chalk.gray('Run: aion deepeval init'));
        process.exit(1);
      }
      const res = spawnSync('python3', [scriptPath], { stdio: 'inherit' });
      if (typeof res.status === 'number') process.exit(res.status);
      process.exit(1);
    });
}
