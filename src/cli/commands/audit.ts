import type { Command } from 'commander';
import chalk from 'chalk';
import { Orchestrator } from '../../core/orchestrator.js';
import { Renderer } from '../ui/renderer.js';
import type { AuditFinding } from '../../schemas/audit.js';

const SEVERITY_COLOR: Record<string, (s: string) => string> = {
  critical: chalk.bgRed.white.bold,
  high:     chalk.red.bold,
  medium:   chalk.yellow,
  low:      chalk.gray,
  info:     chalk.dim,
};

const SEVERITY_ICON: Record<string, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '⚪',
  info:     '🔵',
};

function renderAuditReport(report: {
  findings: AuditFinding[];
  criticalCount: number;
  highCount: number;
  totalFiles: number;
  summary: string;
  topPriorities: string[];
}, durationMs: number): void {
  console.log('\n' + chalk.bold('═'.repeat(60)));
  console.log(chalk.bold.cyan('  AUDIT REPORT') + chalk.gray(` — ${report.totalFiles} files — ${(durationMs / 1000).toFixed(1)}s`));
  console.log(chalk.bold('═'.repeat(60)));

  // Summary
  console.log('\n' + chalk.bold('Summary:'));
  console.log('  ' + report.summary);

  // Counts
  const counts = [
    report.criticalCount > 0 ? chalk.bgRed.white.bold(` ${report.criticalCount} critical `) : null,
    report.highCount > 0 ? chalk.red.bold(`${report.highCount} high`) : null,
    chalk.gray(`${report.findings.filter(f => f.severity === 'medium').length} medium`),
    chalk.gray(`${report.findings.filter(f => f.severity === 'low').length} low`),
  ].filter(Boolean);
  console.log('\n' + chalk.bold('Severity:') + '  ' + counts.join('  '));

  // Top priorities
  if (report.topPriorities.length > 0) {
    console.log('\n' + chalk.bold('Top Priorities:'));
    report.topPriorities.forEach((p, i) => {
      console.log(chalk.cyan(`  ${i + 1}.`) + ' ' + p);
    });
  }

  // Findings grouped by severity
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  for (const sev of order) {
    const group = report.findings.filter(f => f.severity === sev);
    if (group.length === 0) continue;

    const color = SEVERITY_COLOR[sev] ?? chalk.white;
    const icon = SEVERITY_ICON[sev] ?? '';
    console.log('\n' + color(` ${icon} ${sev.toUpperCase()} (${group.length}) `));

    for (const f of group) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      console.log(chalk.bold(`  ${loc}`) + chalk.gray(` [${f.category}]`));
      console.log(`    ${f.finding}`);
      console.log(chalk.dim(`    → ${f.recommendation}`));
      console.log();
    }
  }

  console.log(chalk.bold('═'.repeat(60)));
}

export function registerAudit(program: Command): void {
  program
    .command('audit [target]')
    .description('Deep parallel audit: N scanners cover all files, synthesizer unifies findings')
    .option('-n, --scanners <n>', 'number of parallel scanner agents', '5')
    .action(async (target: string = '.', options: { scanners: string }) => {
      const n = Math.max(1, Math.min(10, parseInt(options.scanners, 10) || 5));
      const renderer = new Renderer();
      const orch = new Orchestrator(process.cwd());

      orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
      orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
      orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));

      const start = Date.now();
      console.log(chalk.bold.cyan(`\nStarting audit with ${n} parallel scanners...\n`));

      try {
        const report = await orch.runAuditPipeline(target, n);
        renderAuditReport(report, Date.now() - start);
        console.log(chalk.dim(orch.costs.summary()));
        process.exit(report.criticalCount > 0 ? 2 : report.highCount > 0 ? 1 : 0);
      } catch (err) {
        renderer.showError(err);
        process.exit(1);
      }
    });
}
