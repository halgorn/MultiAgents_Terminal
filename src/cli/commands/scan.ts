import type { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { ensureGitignore } from '../../infra/gitignore-guard.js';
import { buildApiMap, auditEnvVars, measureCognitiveLoad, scanCurrentSecrets } from '../../infra/code-metrics.js';
import { buildSbom } from '../../infra/sbom.js';
import { refreshUnifiedReport } from '../../infra/report-refresh.js';
import { analyzeLineSize } from '../../infra/line-size-analyzer.js';
import { analyzeSeoAndCrawlers } from '../../infra/seo-analyzer.js';
import { formatSeoMarkdown, printSeoReport } from './scan-seo.js';

async function refreshScanDashboard(cwd: string, scanName: string): Promise<void> {
  await refreshUnifiedReport(cwd, {
    reason: `Updating dashboard after ${scanName}`,
  });
}

export function registerScan(program: Command): void {
  const scan = program
    .command('scan')
    .description('Zero-token code scans: api-map, env-audit, cognitive-load, file-size, seo, secrets, sbom');

  // ── api-map ────────────────────────────────────────────────────────────────
  scan
    .command('api-map')
    .description('Extract all API endpoints with auth and rate-limit status')
    .option('--json', 'output as JSON')
    .option('--output <file>', 'write JSON output to file')
    .action(async (options: { json?: boolean; output?: string }) => {
      const cwd = process.cwd();
      ensureGitignore(cwd);
      const endpoints = buildApiMap(cwd);
      if (options.json || options.output) {
        const out = JSON.stringify(endpoints, null, 2) + '\n';
        if (options.output) { mkdirSync(dirname(options.output), { recursive: true }); writeFileSync(options.output, out, 'utf8'); }
        else process.stdout.write(out);
        return;
      }
      console.log(chalk.bold.cyan('\nAPI Map\n'));
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
    .option('--json', 'output as JSON')
    .option('--output <file>', 'write JSON output to file')
    .action(async (options: { json?: boolean; output?: string }) => {
      const cwd = process.cwd();
      const result = auditEnvVars(cwd);
      if (options.json || options.output) {
        const out = JSON.stringify(result, null, 2) + '\n';
        if (options.output) { mkdirSync(dirname(options.output), { recursive: true }); writeFileSync(options.output, out, 'utf8'); }
        else process.stdout.write(out);
        return;
      }
      console.log(chalk.bold.cyan('\nEnvironment Variables Audit\n'));
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
    .option('--json', 'output as JSON')
    .option('--output <file>', 'write JSON output to file')
    .action(async (options: { top: string; json?: boolean; output?: string }) => {
      const cwd = process.cwd();
      const top = parseInt(options.top, 10) || 20;
      const entries = measureCognitiveLoad(cwd, top);
      if (options.json || options.output) {
        const out = JSON.stringify(entries, null, 2) + '\n';
        if (options.output) { mkdirSync(dirname(options.output), { recursive: true }); writeFileSync(options.output, out, 'utf8'); }
        else process.stdout.write(out);
        return;
      }
      console.log(chalk.bold.cyan('\nCognitive Load Analysis\n'));
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

  // ── file-size ──────────────────────────────────────────────────────────────
  scan
    .command('file-size')
    .description('Check source files against the maintainability line limit')
    .option('--limit <n>', 'maximum lines per source file', '500')
    .option('--json', 'output as JSON')
    .option('--output <file>', 'write JSON output to file')
    .action(async (options: { limit: string; json?: boolean; output?: string }) => {
      const cwd = process.cwd();
      const limit = Math.max(50, parseInt(options.limit, 10) || 500);
      const report = analyzeLineSize(cwd, limit);
      if (options.json || options.output) {
        const out = JSON.stringify(report, null, 2) + '\n';
        if (options.output) { mkdirSync(dirname(options.output), { recursive: true }); writeFileSync(options.output, out, 'utf8'); }
        else process.stdout.write(out);
        return;
      }
      console.log(chalk.bold.cyan('\nFile Size Guardrail\n'));
      if (report.oversized.length === 0) {
        console.log(chalk.green(`✓ No source files over ${report.limit} lines`));
        console.log(chalk.dim(`  Checked ${report.checkedFiles} source files`));
        await refreshScanDashboard(cwd, 'scan file-size');
        return;
      }
      report.oversized.slice(0, 30).forEach((entry) => {
        console.log(chalk.yellow(`  ${entry.lines.toString().padStart(4)} lines  +${entry.overBy.toString().padEnd(4)}  ${entry.file}`));
      });
      if (report.oversized.length > 30) console.log(chalk.dim(`  ... and ${report.oversized.length - 30} more`));
      console.log(chalk.bold(`\nSummary: ${report.oversized.length}/${report.checkedFiles} source files over ${report.limit} lines`));
      await refreshScanDashboard(cwd, 'scan file-size');
    });

  // ── seo ───────────────────────────────────────────────────────────────────
  scan
    .command('seo')
    .description('Analyze SEO, analytics, crawler policy, and Next.js route coverage')
    .option('--json', 'print the SEO report as JSON')
    .option('--markdown', 'print the SEO report as Markdown')
    .option('--output <file>', 'write JSON or Markdown output to a file')
    .option('--fail-under <score>', 'exit with code 1 when SEO score is below this threshold')
    .action(async (options: { json?: boolean; markdown?: boolean; output?: string; failUnder?: string }) => {
      const cwd = process.cwd();
      const report = analyzeSeoAndCrawlers(cwd);
      const failUnder = options.failUnder ? Math.max(0, Math.min(100, parseInt(options.failUnder, 10) || 0)) : 0;
      if (options.json || options.markdown) {
        const output = options.markdown ? formatSeoMarkdown(report) : JSON.stringify(report, null, 2) + '\n';
        if (options.output) {
          mkdirSync(dirname(options.output), { recursive: true });
          writeFileSync(options.output, output, 'utf8');
        } else {
          process.stdout.write(output);
        }
        if (failUnder > 0 && report.score < failUnder) process.exit(1);
        return;
      }
      printSeoReport(report);
      if (failUnder > 0 && report.score < failUnder) {
        console.error(chalk.red(`\nSEO score ${report.score}/100 is below required ${failUnder}/100`));
        process.exitCode = 1;
      }
      await refreshScanDashboard(cwd, 'scan seo');
    });

  // ── secrets ────────────────────────────────────────────────────────────────
  scan
    .command('secrets')
    .description('Scan current files for hardcoded secrets and credentials')
    .option('--json', 'output as JSON')
    .option('--output <file>', 'write JSON output to file')
    .option('--fail-on-found', 'exit with code 1 if any secrets are found (for CI)')
    .action(async (options: { json?: boolean; output?: string; failOnFound?: boolean }) => {
      const cwd = process.cwd();
      const hits = scanCurrentSecrets(cwd);
      if (options.json || options.output) {
        const out = JSON.stringify(hits, null, 2) + '\n';
        if (options.output) { mkdirSync(dirname(options.output), { recursive: true }); writeFileSync(options.output, out, 'utf8'); }
        else process.stdout.write(out);
        if (options.failOnFound && hits.length > 0) process.exitCode = 1;
        return;
      }
      console.log(chalk.bold.cyan('\nSecrets Scan (current files)\n'));
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
      if (options.failOnFound) process.exitCode = 1;
      await refreshScanDashboard(cwd, 'scan secrets');
    });

  // ── sbom ───────────────────────────────────────────────────────────────────
  scan
    .command('sbom')
    .description('Software Bill of Materials: all dependencies with versions and pin status')
    .option('--unpinned-only', 'show only unpinned dependencies')
    .option('--json', 'output as JSON')
    .option('--output <file>', 'write JSON output to file')
    .action(async (options: { unpinnedOnly?: boolean; json?: boolean; output?: string }) => {
      const cwd = process.cwd();
      const report = buildSbom(cwd);
      if (options.json || options.output) {
        const out = JSON.stringify(report, null, 2) + '\n';
        if (options.output) { mkdirSync(dirname(options.output), { recursive: true }); writeFileSync(options.output, out, 'utf8'); }
        else process.stdout.write(out);
        return;
      }
      console.log(chalk.bold.cyan('\nSoftware Bill of Materials\n'));
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
