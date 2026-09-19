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

function termWidth(): number {
  return process.stdout.columns ?? 60;
}

function elapsed(startMs: number): string {
  const s = ((Date.now() - startMs) / 1000).toFixed(1);
  return chalk.dim(`${s}s`);
}

export class Renderer {
  private spinners = new Map<string, Ora>();
  private startedAt = new Map<string, number>();
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
    const w = termWidth();

    const segments = STATE_ORDER.filter((s) => s !== 'FAILED').map((s, i) => {
      if (isFailed && i < activeIdx) return chalk.green(`✓ ${s}`);
      if (s === active) return chalk.bold.white(`[${s}]`);
      const idx = STATE_ORDER.indexOf(s);
      return idx < activeIdx ? chalk.green(`✓ ${s}`) : chalk.gray(s);
    });
    if (isFailed) segments.push(chalk.bold.red('[FAILED]'));

    const sep = chalk.dim(' → ');
    const sepLen = 4;
    const lines: string[][] = [[]];
    let lineLen = 0;

    for (const seg of segments) {
      const rawLen = seg.replace(/\x1b\[[^m]*m/g, '').length;
      if (lines[lines.length - 1]!.length > 0 && lineLen + sepLen + rawLen > w) {
        lines.push([]);
        lineLen = 0;
      }
      if (lines[lines.length - 1]!.length > 0) lineLen += sepLen;
      lines[lines.length - 1]!.push(seg);
      lineLen += rawLen;
    }

    process.stdout.write(lines.map((l) => l.join(sep)).join('\n') + '\n\n');
  }

  agentStart(agentName: string): void {
    this.startedAt.set(agentName, Date.now());
    const spinner = ora({ text: chalk.dim(`${agentName} thinking...`), spinner: 'dots' }).start();
    this.spinners.set(agentName, spinner);
  }

  agentChunk(agentName: string, text: string): void {
    const spinner = this.spinners.get(agentName);
    const t = elapsed(this.startedAt.get(agentName) ?? Date.now());
    if (spinner) {
      const preview = text.replace(/\n/g, ' ').slice(-55);
      spinner.text = chalk.dim(`[${agentName}]`) + ` ${t} ` + preview;
    } else {
      process.stdout.write(chalk.dim(`[${agentName}] `) + text);
    }
  }

  agentDone(agentName: string, durationMs: number): void {
    const spinner = this.spinners.get(agentName);
    if (spinner) {
      const secs = (durationMs / 1000).toFixed(1);
      spinner.succeed(chalk.green(`${agentName} done`) + chalk.gray(` (${secs}s)`));
      this.spinners.delete(agentName);
      this.startedAt.delete(agentName);
    }
  }

  showError(err: unknown): void {
    for (const [, spinner] of this.spinners) spinner.fail();
    this.spinners.clear();
    this.startedAt.clear();
    const rawMsg = err instanceof Error ? err.message : String(err);
    const msg = rawMsg.split('\n').map((line, i) => (i === 0 ? line : `    ${line}`)).join('\n');
    process.stderr.write(chalk.red('\n✗ Error: ') + chalk.red(msg) + '\n');
  }

  showCost(summary: string): void {
    console.log(chalk.dim('\n' + summary));
  }

  showResult(result: TaskResult): void {
    for (const [, spinner] of this.spinners) spinner.stop();
    this.spinners.clear();
    this.startedAt.clear();

    const sep = chalk.bold('─'.repeat(Math.min(termWidth(), 70)));
    console.log('\n' + sep);

    if (result.state === 'DONE') {
      const secs = (result.durationMs / 1000).toFixed(1);
      console.log(chalk.bold.green('✓ DONE') + chalk.gray(` in ${secs}s`));
    } else if (result.state === 'REPRODUCED' && result.plan) {
      const secs = (result.durationMs / 1000).toFixed(1);
      console.log(chalk.bold.cyan('✓ ANALYSIS COMPLETE') + chalk.gray(` in ${secs}s`));
    } else {
      const secs = (result.durationMs / 1000).toFixed(1);
      console.log(chalk.bold.red(`✗ ${result.state}`) + chalk.gray(` after ${secs}s`));
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
      const conf = result.evidence.confidence;
      const confColor = conf >= 80 ? chalk.green : conf >= 50 ? chalk.yellow : chalk.red;
      console.log(chalk.bold('\nEvidence:'));
      console.log(`  Reproduced: ${result.evidence.reproduced ? chalk.green('yes') : chalk.red('no')}`);
      console.log(`  Confidence: ${confColor(conf + '%')}`);
      console.log(`  Summary: ${result.evidence.summary}`);
    }

    if (result.patch) {
      console.log(chalk.bold('\nPatch:'));
      console.log(`  Files: ${result.patch.filesChanged.join(', ')}`);
      console.log(`  ${result.patch.description}`);
      if (result.applied === true) {
        console.log(`  ${chalk.green('Applied to working tree')}`);
      } else if (result.applied === false) {
        console.log(`  ${chalk.red('NOT applied')}: ${result.applyError ?? 'unknown error'}`);
      }
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

    console.log(sep);
  }
}
