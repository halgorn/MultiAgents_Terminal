import type { Command } from 'commander';
import chalk from 'chalk';
import { loadTraces, formatDuration } from '../../infra/tracer.js';
import { langfuseStatusLine } from '../../infra/langfuse.js';

export function registerTrace(program: Command): void {
  program
    .command('trace')
    .description('Show agent run traces: cost, tokens, and latency per agent')
    .option('-n, --last <n>', 'number of recent runs to show', '10')
    .option('--id <traceId>', 'show full span breakdown for a specific trace')
    .option('--json', 'output raw JSON')
    .action((options: { last: string; id?: string; json?: boolean }) => {
      const cwd = process.cwd();
      const limit = Math.max(1, parseInt(options.last, 10) || 10);
      const traces = loadTraces(cwd, limit);

      if (traces.length === 0) {
        console.log(chalk.gray('No traces found. Run `aion audit` or `aion fix` first.'));
        console.log(chalk.gray('Traces are saved to .ai-runtime/traces.jsonl'));
        console.log(chalk.gray(`LangFuse: ${langfuseStatusLine()}`));
        return;
      }

      if (options.json) {
        const data = options.id ? traces.find((t) => t.traceId.startsWith(options.id!)) : traces;
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (options.id) {
        const trace = traces.find((t) => t.traceId.startsWith(options.id!));
        if (!trace) { console.error(chalk.red(`Trace not found: ${options.id}`)); return; }
        printSpanBreakdown(trace);
        return;
      }

      // Summary table
      console.log(chalk.bold(`\nRecent runs (${traces.length})\n`));
      console.log(chalk.gray(`  LangFuse: ${langfuseStatusLine()}`));
      console.log(
        chalk.gray('  ' + [
          'traceId'.padEnd(10),
          'command'.padEnd(10),
          'agents'.padStart(7),
          'tokens'.padStart(8),
          'cost'.padStart(8),
          'duration'.padStart(10),
          'status'.padStart(8),
        ].join('  ')),
      );
      console.log(chalk.gray('  ' + '─'.repeat(70)));

      for (const t of traces) {
        const id = t.traceId.slice(0, 8);
        const cmd = t.command.slice(0, 10);
        const agents = String(t.spans.length).padStart(7);
        const tokens = String(t.totalTokens).padStart(8);
        const cost = `$${t.totalCostUsd.toFixed(4)}`.padStart(8);
        const dur = formatDuration(t.endMs - t.startMs).padStart(10);
        const hasError = t.spans.some((s) => s.status === 'error');
        const status = hasError ? chalk.red('  error') : chalk.green('     ok');
        const date = new Date(t.startMs).toLocaleTimeString();
        console.log(`  ${chalk.cyan(id)}  ${cmd.padEnd(10)}  ${agents}  ${tokens}  ${chalk.yellow(cost)}  ${dur}  ${status}  ${chalk.gray(date)}`);
      }

      console.log(chalk.gray(`\n  Use --id <traceId> for span breakdown, --json for raw output`));
    });
}

function printSpanBreakdown(trace: { traceId: string; command: string; startMs: number; endMs: number; totalCostUsd: number; spans: Array<{ agent: string; model: string; durationMs: number; inputTokens: number; outputTokens: number; cacheTokens: number; costUsd: number; status: string; error?: string }> }): void {
  console.log(chalk.bold(`\nTrace: ${trace.traceId}`));
  console.log(`  Command:  ${chalk.cyan(trace.command)}`);
  console.log(`  Duration: ${formatDuration(trace.endMs - trace.startMs)}`);
  console.log(`  Total:    ${chalk.yellow('$' + trace.totalCostUsd.toFixed(4))}\n`);

  console.log(chalk.gray('  ' + [
    'agent'.padEnd(28),
    'model'.padEnd(20),
    'in'.padStart(7),
    'out'.padStart(7),
    'cache'.padStart(7),
    'cost'.padStart(8),
    'dur'.padStart(8),
  ].join('  ')));
  console.log(chalk.gray('  ' + '─'.repeat(95)));

  for (const s of trace.spans) {
    const agent = s.agent.slice(0, 28).padEnd(28);
    const model = s.model.replace('claude-', '').slice(0, 20).padEnd(20);
    const statusMark = s.status === 'error' ? chalk.red('✗') : chalk.green('✓');
    console.log(
      `  ${statusMark} ${agent}  ${chalk.gray(model)}  ` +
      `${String(s.inputTokens).padStart(7)}  ${String(s.outputTokens).padStart(7)}  ` +
      `${String(s.cacheTokens).padStart(7)}  ${chalk.yellow(('$' + s.costUsd.toFixed(4)).padStart(8))}  ` +
      `${formatDuration(s.durationMs).padStart(8)}`,
    );
    if (s.error) console.log(chalk.red(`      ${s.error.slice(0, 80)}`));
  }
}
