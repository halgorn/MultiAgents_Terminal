import type { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { computeHealthScore } from '../../infra/health-score.js';
import { buildChurnReport } from '../../infra/git-analysis.js';
import { measureCognitiveLoad } from '../../infra/code-metrics.js';
import { detectPatterns } from '../../infra/pattern-detect.js';
import { GraphAgent } from '../../agents/graph-agent.js';
import { appendTrend, loadTrend, renderTrendChart } from '../../infra/audit-trend.js';
import { loadLatestAudit } from '../../infra/project-report.js';
import { refreshUnifiedReport } from '../../infra/report-refresh.js';

export function registerHealth(program: Command): void {
  program
    .command('health')
    .description('Composite health score (0-100) across security, architecture, tests, churn, and maintainability')
    .option('--threshold <n>', 'exit code 1 if score below threshold (for CI gate)', '0')
    .option('--days <n>', 'git lookback period for churn/bus-factor', '90')
    .option('--trend', 'show historical score chart')
    .option('--json', 'output raw JSON')
    .option('--output <file>', 'write JSON output to a file')
    .action(async (options: { threshold: string; days: string; trend?: boolean; json?: boolean; output?: string }) => {
      const cwd = process.cwd();
      const threshold = parseInt(options.threshold, 10) || 0;
      const days = parseInt(options.days, 10) || 90;

      if (!options.json) console.log(chalk.bold.cyan('\nProject Health Score\n'));

      // Gather all inputs
      const graph = new GraphAgent(cwd);
      const index = await graph.ensureIndex();

      const testFiles = index.files.filter((f) => f.isTest).length;
      const testFileRatio = index.files.length > 0 ? testFiles / index.files.length : 0;

      let cycles = 0, hotspots = 0, hotspotFiles: string[] = [];
      try {
        const { detectLang } = await import('../../infra/lang-detect.js');
        const { buildDepGraphAuto } = await import('../../infra/dep-graph.js');
        
        const lang = detectLang(cwd);
        const dep = buildDepGraphAuto(cwd, lang.lang);
        cycles = dep.cycles.length;
        hotspots = dep.hotspots.length;
        hotspotFiles = dep.hotspots.map((h) => h.file);
      } catch { /* best-effort */ }

      const audit = loadLatestAudit(cwd);
      const churnReport = buildChurnReport(cwd, hotspotFiles, days);
      const cognitive = measureCognitiveLoad(cwd, 30);
      const patterns = detectPatterns(cwd, hotspotFiles.map((f) => ({ file: f, fanIn: 0, fanOut: 0 })));

      const score = computeHealthScore({
        totalFiles: index.stats.files,
        totalSymbols: index.stats.symbols,
        cycles,
        hotspots,
        testFileRatio,
        churn: churnReport.churn,
        busFactor: churnReport.busFactor,
        cognitiveLoad: cognitive,
        patterns,
        auditCriticals: audit?.criticalCount,
        auditHighs: audit?.highCount,
      });

      // --trend: show chart and exit
      if (options.trend) {
        const trend = loadTrend(cwd);
        console.log(chalk.bold.cyan('\nHealth Score History\n'));
        renderTrendChart(trend.entries);
        return;
      }

      // Append to trend history
      appendTrend(cwd, {
        timestamp: new Date().toISOString(),
        score: score.total,
        grade: score.grade,
        dimensions: Object.fromEntries(score.dimensions.map((d) => [d.name, d.score])),
        totalFiles: index.stats.files,
      });

      if (options.json) {
        const output = JSON.stringify(score, null, 2) + '\n';
        if (options.output) {
          mkdirSync(dirname(options.output), { recursive: true });
          writeFileSync(options.output, output, 'utf8');
        } else {
          console.log(output.trimEnd());
        }
        if (threshold > 0 && score.total < threshold) process.exit(1);
        return;
      }

      // Render
      const gradeColor = { A: chalk.green.bold, B: chalk.green, C: chalk.yellow, D: chalk.red, F: chalk.red.bold }[score.grade] ?? chalk.white;
      console.log(`  ${score.badge}\n`);

      console.log(chalk.bold('── Dimensions ─────────────────────────────────────────────'));
      score.dimensions.forEach((d) => {
        const pct = d.score;
        const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
        const color = pct >= 80 ? chalk.green : pct >= 60 ? chalk.yellow : chalk.red;
        console.log(
          `  ${d.name.padEnd(16)} ${color(bar)} ${color(pct.toString().padStart(3))}  ${chalk.dim(d.detail)}`,
        );
      });

      if (score.topRisks.length > 0) {
        console.log(chalk.bold('\n── Top Risks ──────────────────────────────────────────────'));
        score.topRisks.forEach((r) => console.log(chalk.red(`  ✗ ${r}`)));
      }

      if (!audit) {
        console.log(chalk.dim('\n  Tip: run `audit` first for security dimension accuracy'));
      }

      let failedThreshold = false;
      if (threshold > 0) {
        if (score.total < threshold) {
          console.log(chalk.red(`\n✗ Score ${score.total} below threshold ${threshold} — CI gate failed`));
          failedThreshold = true;
        } else {
          console.log(chalk.green(`\n✓ Score ${score.total} meets threshold ${threshold}`));
        }
      }

      await refreshUnifiedReport(cwd, {
        reason: 'Updating dashboard after health check',
      });
      if (failedThreshold) process.exit(1);
    });
}
