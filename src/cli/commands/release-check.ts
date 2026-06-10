import type { Command } from 'commander';
import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { scanCurrentSecrets } from '../../infra/code-metrics.js';
import { analyzeLineSize } from '../../infra/line-size-analyzer.js';
import { buildSbom } from '../../infra/sbom.js';
import { analyzeSeoAndCrawlers } from '../../infra/seo-analyzer.js';
import { runPackageGuard } from '../../infra/package-guard.js';

interface ReleaseCheckOptions {
  json?: boolean;
  skipBuild?: boolean;
  lineLimit: string;
  seoFailUnder: string;
  maxPackageKb: string;
}

function runStep(name: string, command: string, args: string[], cwd: string): { ok: boolean; detail: string } {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-3).join('\n');
  return { ok: result.status === 0, detail };
}

export function registerReleaseCheck(program: Command): void {
  program
    .command('release-check')
    .description('Run local release gates before npm publish')
    .option('--json', 'print machine-readable result')
    .option('--skip-build', 'skip npm run build')
    .option('--line-limit <n>', 'maximum lines per source file', '500')
    .option('--seo-fail-under <n>', 'minimum SEO score', '0')
    .option('--max-package-kb <n>', 'maximum npm tarball size in KB', '750')
    .action((options: ReleaseCheckOptions) => {
      const cwd = process.cwd();
      const lineLimit = Math.max(50, parseInt(options.lineLimit, 10) || 500);
      const seoFailUnder = Math.max(0, Math.min(100, parseInt(options.seoFailUnder, 10) || 0));
      const maxPackageKb = Math.max(50, parseInt(options.maxPackageKb, 10) || 750);
      const steps: Array<{ name: string; ok: boolean; detail: string }> = [];

      if (!options.skipBuild) {
        steps.push({ name: 'build', ...runStep('build', 'npm', ['run', 'build'], cwd) });
      }

      const secrets = scanCurrentSecrets(cwd);
      steps.push({ name: 'secrets', ok: secrets.length === 0, detail: `${secrets.length} potential secret(s)` });

      const lineSize = analyzeLineSize(cwd, lineLimit);
      steps.push({ name: 'file-size', ok: lineSize.oversized.length === 0, detail: `${lineSize.oversized.length}/${lineSize.checkedFiles} over ${lineLimit} lines` });

      const sbom = buildSbom(cwd);
      steps.push({ name: 'sbom', ok: true, detail: `${sbom.totalCount} package(s), ${sbom.unpinned.length} unpinned` });

      const seo = analyzeSeoAndCrawlers(cwd);
      steps.push({ name: 'seo', ok: seoFailUnder === 0 || seo.score >= seoFailUnder, detail: `${seo.score}/100, ${seo.issues.length} issue(s)` });

      const pack = runPackageGuard(cwd, maxPackageKb);
      steps.push({ name: 'npm-pack', ok: pack.ok, detail: `${pack.packageSizeKb} KB, ${pack.fileCount} file(s)` });

      const problems = [...steps.filter((step) => !step.ok).map((step) => `${step.name}: ${step.detail}`), ...pack.problems];
      const passed = problems.length === 0;

      if (options.json) {
        process.stdout.write(JSON.stringify({
          passed,
          steps,
          package: {
            ok: pack.ok,
            packageSizeKb: pack.packageSizeKb,
            unpackedSizeKb: pack.unpackedSizeKb,
            fileCount: pack.fileCount,
          },
          problems,
        }, null, 2) + '\n');
      } else {
        process.stdout.write(chalk.bold.cyan('\nRelease Check\n\n'));
        for (const step of steps) {
          process.stdout.write(`${step.ok ? chalk.green('✓') : chalk.red('✗')} ${step.name.padEnd(12)} ${chalk.dim(step.detail)}\n`);
        }
        if (problems.length > 0) {
          process.stdout.write(chalk.red('\nProblems:\n'));
          problems.forEach((problem) => process.stdout.write(`  - ${problem}\n`));
        }
      }

      if (!passed) process.exit(1);
    });
}
