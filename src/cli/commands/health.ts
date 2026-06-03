import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { computeHealthScore } from '../../infra/health-score.js';
import { buildChurnReport } from '../../infra/git-analysis.js';
import { measureCognitiveLoad } from '../../infra/code-metrics.js';
import { detectPatterns } from '../../infra/pattern-detect.js';
import { GraphAgent } from '../../agents/graph-agent.js';

interface LatestAudit {
  criticalCount: number;
  highCount: number;
  totalFiles: number;
}

function loadLatestAudit(cwd: string): LatestAudit | null {
  const dir = join(cwd, '.ai-runtime', 'reports');
  if (!existsSync(dir)) return null;
  try {
    const files = readdirSync(dir).filter((f) => f.startsWith('audit-') && f.endsWith('.json')).sort().reverse();
    if (files.length === 0) return null;
    const content = readFileSync(join(dir, files[0]!), 'utf8');
    const parsed = JSON.parse(content) as LatestAudit;
    return { criticalCount: parsed.criticalCount ?? 0, highCount: parsed.highCount ?? 0, totalFiles: parsed.totalFiles ?? 0 };
  } catch { return null; }
}

export function registerHealth(program: Command): void {
  program
    .command('health')
    .description('Composite health score (0-100) across security, architecture, tests, churn, and maintainability')
    .option('--threshold <n>', 'exit code 1 if score below threshold (for CI gate)', '0')
    .option('--days <n>', 'git lookback period for churn/bus-factor', '90')
    .option('--json', 'output raw JSON')
    .action(async (options: { threshold: string; days: string; json?: boolean }) => {
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
        const { buildDepGraph } = await import('../../infra/dep-graph.js');
        const { buildPythonDepGraph } = await import('../../infra/dep-graph-python.js');
        const lang = detectLang(cwd);
        const dep = lang.lang === 'python' ? buildPythonDepGraph(cwd) : buildDepGraph(cwd);
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

      if (options.json) {
        console.log(JSON.stringify(score, null, 2));
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

      if (threshold > 0) {
        if (score.total < threshold) {
          console.log(chalk.red(`\n✗ Score ${score.total} below threshold ${threshold} — CI gate failed`));
          process.exit(1);
        } else {
          console.log(chalk.green(`\n✓ Score ${score.total} meets threshold ${threshold}`));
        }
      }
    });
}
