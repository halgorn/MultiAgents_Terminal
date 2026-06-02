import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { STATE_ORDER, type TaskState } from '../../core/state-machine.js';
import type { TaskResult } from '../../core/task.js';

const STATE_COLOR: Record<TaskState, (s: string) => string> = {
  NEW: chalk.gray,
  INVESTIGATING: chalk.yellow,
  REPRODUCED: chalk.blue,
  ROOT_CAUSE_FOUND: chalk.cyan,
  PATCH_CREATED: chalk.magenta,
  REVIEWED: chalk.blueBright,
  TESTED: chalk.green,
  VERIFIED: chalk.greenBright,
  DONE: chalk.bold.green,
  FAILED: chalk.bold.red,
};

export class Renderer {
  private spinners = new Map<string, Ora>();
  private currentState: TaskState = 'NEW';

  showState(state: TaskState): void {
    this.currentState = state;
    const color = STATE_COLOR[state] ?? chalk.white;
    process.stdout.write('\n' + color(`▶ ${state}`) + '\n');
    this.printProgress(state);
  }

  private printProgress(active: TaskState): void {
    const activeIdx = STATE_ORDER.indexOf(active);
    const isFailed = active === 'FAILED';

    const bar = STATE_ORDER.filter((s) => s !== 'FAILED').map((s, i) => {
      if (isFailed && i < activeIdx) return chalk.green(`✓ ${s}`);
      if (s === active) return chalk.bold.white(`[${s}]`);
      const idx = STATE_ORDER.indexOf(s);
      return idx < activeIdx ? chalk.green(`✓ ${s}`) : chalk.gray(s);
    }).join(' → ');

    const suffix = isFailed ? ' → ' + chalk.bold.red('[FAILED]') : '';
    process.stdout.write(bar + suffix + '\n\n');
  }

  agentStart(agentName: string): void {
    const spinner = ora({ text: chalk.dim(`${agentName} thinking...`), spinner: 'dots' }).start();
    this.spinners.set(agentName, spinner);
  }

  agentChunk(agentName: string, text: string): void {
    const spinner = this.spinners.get(agentName);
    if (spinner) {
      // Show last 60 chars of output as spinner suffix
      const preview = text.replace(/\n/g, ' ').slice(-60);
      spinner.text = chalk.dim(`[${agentName}] `) + preview;
    } else {
      process.stdout.write(chalk.dim(`[${agentName}] `) + text);
    }
  }

  agentDone(agentName: string, durationMs: number): void {
    const spinner = this.spinners.get(agentName);
    if (spinner) {
      spinner.succeed(chalk.green(`${agentName} done`) + chalk.gray(` (${durationMs}ms)`));
      this.spinners.delete(agentName);
    }
  }

  showError(err: unknown): void {
    for (const [, spinner] of this.spinners) spinner.fail();
    this.spinners.clear();
    console.error(chalk.red('\n✗ Error: ') + (err instanceof Error ? err.message : String(err)));
  }

  showResult(result: TaskResult): void {
    for (const [, spinner] of this.spinners) spinner.stop();
    this.spinners.clear();

    console.log('\n' + chalk.bold('─'.repeat(60)));

    if (result.state === 'DONE') {
      console.log(chalk.bold.green('✓ DONE') + chalk.gray(` in ${result.durationMs}ms`));
    } else if (result.state === 'REPRODUCED' && result.plan) {
      console.log(chalk.bold.cyan('✓ ANALYSIS COMPLETE') + chalk.gray(` in ${result.durationMs}ms`));
    } else {
      console.log(chalk.bold.red(`✗ ${result.state}`) + chalk.gray(` after ${result.durationMs}ms`));
      if (result.errors.length > 0) {
        console.log(chalk.red('\nErrors:'));
        result.errors.forEach((e) => console.log(chalk.red(`  • ${e}`)));
      }
    }

    if (result.plan && !result.evidence) {
      console.log(chalk.bold('\nAnalysis:'));
      console.log(`  ${result.plan.summary}`);
      console.log(`  Risk: ${chalk.yellow(result.plan.riskLevel)}`);
      if (result.plan.relevantModules.length > 0) {
        console.log(`  Modules: ${result.plan.relevantModules.join(', ')}`);
      }
      if (result.plan.constraints.length > 0) {
        console.log(chalk.bold('\nFindings:'));
        result.plan.constraints.forEach((c) => console.log(`  • ${c}`));
      }
    }

    if (result.evidence) {
      console.log(chalk.bold('\nEvidence:'));
      console.log(`  Reproduced: ${result.evidence.reproduced ? chalk.green('yes') : chalk.red('no')}`);
      console.log(`  Confidence: ${chalk.cyan(result.evidence.confidence + '%')}`);
      console.log(`  Summary: ${result.evidence.summary}`);
    }

    if (result.patch) {
      console.log(chalk.bold('\nPatch:'));
      console.log(`  Files: ${result.patch.filesChanged.join(', ')}`);
      console.log(`  ${result.patch.description}`);
    }

    if (result.review) {
      const approved = result.review.approved;
      console.log(chalk.bold('\nReview:'));
      console.log(`  Approved: ${approved ? chalk.green('yes') : chalk.red('no')}`);
      console.log(`  Regression risk: ${result.review.regressionRisk}`);
      if (result.review.findings.length > 0) {
        console.log(`  Findings: ${result.review.findings.length}`);
      }
    }

    if (result.qaResult) {
      console.log(chalk.bold('\nQA:'));
      console.log(`  Build: ${result.qaResult.buildOk ? chalk.green('OK') : chalk.red('FAIL')}`);
      console.log(`  Tests: ${result.qaResult.testsOk ? chalk.green('OK') : chalk.red('FAIL')}`);
      console.log(`  Bug reproduced after fix: ${result.qaResult.reproductionStillFails ? chalk.red('yes (fix failed)') : chalk.green('no (fix worked)')}`);
    }

    console.log(chalk.bold('─'.repeat(60)));
  }
}
