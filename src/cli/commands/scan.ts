import type { Command } from 'commander';
import chalk from 'chalk';
import { buildApiMap, auditEnvVars, measureCognitiveLoad, scanCurrentSecrets } from '../../infra/code-metrics.js';
import { buildSbom } from '../../infra/sbom.js';
import { refreshUnifiedReport } from '../../infra/report-refresh.js';

async function refreshScanDashboard(cwd: string, scanName: string): Promise<void> {
  await refreshUnifiedReport(cwd, {
    reason: `Updating dashboard after ${scanName}`,
  });
}

export function registerScan(program: Command): void {
  const scan = program
    .command('scan')
    .description('Zero-token code scans: api-map, env-audit, cognitive-load, secrets, sbom');

  // ── api-map ────────────────────────────────────────────────────────────────
  scan
    .command('api-map')
    .description('Extract all API endpoints with auth and rate-limit status')
    .action(async () => {
      const cwd = process.cwd();
      console.log(chalk.bold.cyan('\nAPI Map\n'));
      const endpoints = buildApiMap(cwd);

      if (endpoints.length === 0) {
        console.log(chalk.yellow('No API endpoints detected. Supports FastAPI, Flask, Django, Express.'));
        await refreshScanDashboard(cwd, 'scan api-map');
        return;
      }

      const noAuth = endpoints.filter((e) => !e.hasAuth);
      const noRateLimit = endpoints.filter((e) => !e.hasRateLimit);

      endpoints.forEach((ep) => {
        const authIcon = ep.hasAuth ? chalk.green('🔒') : chalk.red('🔓');
        const rlIcon = ep.hasRateLimit ? chalk.green('⏱') : chalk.gray('  ');
        console.log(
          `  ${authIcon}${rlIcon}  ` +
          chalk.bold(ep.method.padEnd(7)) +
          chalk.cyan(ep.path.padEnd(40)) +
          chalk.dim(`${ep.file}:${ep.line}`),
        );
      });

      console.log(chalk.bold(`\nSummary: ${endpoints.length} endpoints`));
      if (noAuth.length > 0) console.log(chalk.red(`  🔓 ${noAuth.length} without auth`));
      if (noRateLimit.length > 0) console.log(chalk.yellow(`  ⏱  ${noRateLimit.length} without rate limiting`));
      await refreshScanDashboard(cwd, 'scan api-map');
    });

  // ── env-audit ──────────────────────────────────────────────────────────────
  scan
    .command('env-audit')
    .description('Find all environment variables used and check if they are documented')
    .action(async () => {
      const cwd = process.cwd();
      console.log(chalk.bold.cyan('\nEnvironment Variables Audit\n'));
      const result = auditEnvVars(cwd);

      if (result.vars.length === 0) {
        console.log(chalk.yellow('No environment variables detected.'));
        await refreshScanDashboard(cwd, 'scan env-audit');
        return;
      }

      if (!result.envExampleExists) {
        console.log(chalk.red('⚠ No .env.example / .env.sample found — new developers cannot know required variables\n'));
      }

      result.vars.forEach((v) => {
        const icon = v.documented ? chalk.green('✓') : chalk.red('✗');
        console.log(`  ${icon}  ${chalk.bold(v.name.padEnd(35))} ${chalk.dim(`${v.file}:${v.line}`)}`);
      });

      console.log(chalk.bold(`\nSummary: ${result.vars.length} env vars`));
      if (result.undocumented.length > 0) {
        console.log(chalk.red(`  ${result.undocumented.length} undocumented: ${result.undocumented.slice(0, 5).join(', ')}${result.undocumented.length > 5 ? '...' : ''}`));
      }
      await refreshScanDashboard(cwd, 'scan env-audit');
    });

  // ── cognitive-load ─────────────────────────────────────────────────────────
  scan
    .command('cognitive-load')
    .description('Measure cognitive difficulty per file: nesting, magic numbers, long functions')
    .option('--top <n>', 'number of files to show', '20')
    .action(async (options: { top: string }) => {
      const cwd = process.cwd();
      const top = parseInt(options.top, 10) || 20;
      console.log(chalk.bold.cyan('\nCognitive Load Analysis\n'));
      const entries = measureCognitiveLoad(cwd, top);

      if (entries.length === 0) {
        console.log(chalk.yellow('No source files found.'));
        await refreshScanDashboard(cwd, 'scan cognitive-load');
        return;
      }

      entries.forEach((e) => {
        const scoreColor = e.score >= 40 ? chalk.red : e.score >= 20 ? chalk.yellow : chalk.green;
        console.log(
          scoreColor(`  ${e.score.toString().padStart(3)}`) +
          chalk.gray(`  nest:${e.maxNesting} fn:${e.longFunctions} magic:${e.magicNumbers} loc:${e.loc}  `) +
          chalk.white(e.file),
        );
      });

      const avgScore = Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length);
      console.log(chalk.bold(`\nAvg score: ${avgScore} · Top ${entries.length} files shown`));
      console.log(chalk.dim('Score = nesting×3 + long-functions×5 + magic-numbers/3 + long-lines penalty'));
      await refreshScanDashboard(cwd, 'scan cognitive-load');
    });

  // ── secrets ────────────────────────────────────────────────────────────────
  scan
    .command('secrets')
    .description('Scan current files for hardcoded secrets and credentials')
    .action(async () => {
      const cwd = process.cwd();
      console.log(chalk.bold.cyan('\nSecrets Scan (current files)\n'));
      const hits = scanCurrentSecrets(cwd);

      if (hits.length === 0) {
        console.log(chalk.green('✓ No hardcoded secrets detected in current files'));
        await refreshScanDashboard(cwd, 'scan secrets');
        return;
      }

      console.log(chalk.red(`⚠ ${hits.length} potential secret(s) found:\n`));
      hits.forEach((h) => {
        console.log(chalk.bold(`  ${h.file}:${h.line}`) + chalk.red(` [${h.pattern}]`));
        console.log(chalk.dim(`    ${h.preview}`));
      });

      console.log(chalk.yellow('\nNote: also check git history for previously committed secrets'));
      await refreshScanDashboard(cwd, 'scan secrets');
    });

  // ── sbom ───────────────────────────────────────────────────────────────────
  scan
    .command('sbom')
    .description('Software Bill of Materials: all dependencies with versions and pin status')
    .option('--unpinned-only', 'show only unpinned dependencies')
    .action(async (options: { unpinnedOnly?: boolean }) => {
      const cwd = process.cwd();
      console.log(chalk.bold.cyan('\nSoftware Bill of Materials\n'));
      const report = buildSbom(cwd);

      if (report.packages.length === 0) {
        console.log(chalk.yellow('No package files found (requirements.txt, package.json, go.mod, Cargo.toml)'));
        await refreshScanDashboard(cwd, 'scan sbom');
        return;
      }

      const packages = options.unpinnedOnly ? report.unpinned : report.packages;
      packages.slice(0, 60).forEach((p) => {
        const icon = p.pinned ? chalk.green('✓') : chalk.red('!');
        console.log(`  ${icon}  ${chalk.gray(p.lang.padEnd(8))} ${chalk.white(p.name.padEnd(30))} ${chalk.dim(p.version)}`);
      });
      if (packages.length > 60) console.log(chalk.dim(`  ... and ${packages.length - 60} more`));

      console.log(chalk.bold(`\nTotal: ${report.totalCount} packages`));
      if (report.unpinned.length > 0) {
        console.log(chalk.yellow(`  ${report.unpinned.length} unpinned (supply chain risk)`));
      }
      await refreshScanDashboard(cwd, 'scan sbom');
    });
}
