import type { Command } from 'commander';
import chalk from 'chalk';
import { detectPatterns } from '../../infra/pattern-detect.js';
import { GraphAgent } from '../../agents/graph-agent.js';

const CONFIDENCE_COLOR: Record<string, (s: string) => string> = {
  high: chalk.green,
  medium: chalk.yellow,
  low: chalk.gray,
};

const SEVERITY_COLOR: Record<string, (s: string) => string> = {
  critical: chalk.red.bold,
  high: chalk.red,
  medium: chalk.yellow,
};

const PRIORITY_COLOR: Record<string, (s: string) => string> = {
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.gray,
};

export function registerPatterns(program: Command): void {
  program
    .command('patterns')
    .description('Detect architectural patterns, anti-patterns, and improvement recommendations')
    .action(async () => {
      const cwd = process.cwd();
      console.log(chalk.bold.cyan('\nArchitecture Pattern Analysis\n'));

      // Load hotspots from graph if available
      let hotspots: Array<{ file: string; fanIn: number; fanOut: number }> = [];
      try {
        const graph = new GraphAgent(cwd);
        const index = graph.getIndex();
        if (index) {
          const { detectLang } = await import('../../infra/lang-detect.js');
          const { buildDepGraphAuto } = await import('../../infra/dep-graph.js');
          
          const lang = detectLang(cwd);
          const dep = buildDepGraphAuto(cwd, lang.lang);
          hotspots = dep.hotspots;
        }
      } catch { /* best-effort */ }

      const report = detectPatterns(cwd, hotspots);

      // Detected patterns
      if (report.detected.length > 0) {
        console.log(chalk.bold('── Detected Patterns ──────────────────────────────────────'));
        report.detected.forEach((p) => {
          const colorFn = CONFIDENCE_COLOR[p.confidence] ?? chalk.white;
          console.log(`\n  ${colorFn('●')} ${chalk.bold(p.pattern)} ${chalk.dim(`[${p.category}]`)} ${chalk.gray(`(${p.confidence} confidence)`)}`);
          p.evidence.filter(Boolean).forEach((e) => console.log(chalk.dim(`      ${e}`)));
        });
      }

      // Anti-patterns
      if (report.antiPatterns.length > 0) {
        console.log(chalk.bold('\n── Anti-Patterns ──────────────────────────────────────────'));
        report.antiPatterns.forEach((a) => {
          const colorFn = SEVERITY_COLOR[a.severity] ?? chalk.white;
          console.log(`\n  ${colorFn('✗')} ${chalk.bold(a.name)} ${chalk.gray(`[${a.severity}]`)}`);
          console.log(chalk.dim(`    ${a.description}`));
          a.evidence.slice(0, 3).forEach((e) => console.log(chalk.dim(`    → ${e}`)));
        });
      } else {
        console.log(chalk.bold('\n── Anti-Patterns ──────────────────────────────────────────'));
        console.log(chalk.green('  ✓ No major anti-patterns detected'));
      }

      // Recommendations
      if (report.recommendations.length > 0) {
        console.log(chalk.bold('\n── Recommendations ────────────────────────────────────────'));
        report.recommendations.forEach((r) => {
          const colorFn = PRIORITY_COLOR[r.priority] ?? chalk.white;
          console.log(`\n  ${colorFn('→')} ${chalk.bold(r.pattern)} ${chalk.gray(`[${r.priority} priority]`)}`);
          console.log(chalk.dim(`    ${r.reason}`));
          r.fixes.forEach((f) => console.log(chalk.dim(`    • ${f}`)));
        });
      }

      console.log(chalk.bold('\n── Summary ────────────────────────────────────────────────'));
      console.log(`  ${report.summary}`);
    });
}
