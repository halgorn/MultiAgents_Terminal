import type { Command } from 'commander';
import chalk from 'chalk';
import { Orchestrator } from '../../core/orchestrator.js';
import { AuditPipeline } from '../../core/pipelines/audit-pipeline.js';
import { createRuntimePolicy } from '../../core/runtime-policy.js';
import { CostTracker } from '../../core/cost-tracker.js';
import { Renderer } from '../ui/renderer.js';
import { saveAuditReport } from '../../infra/audit-report-writer.js';
import { SEVERITY_RANK, type CostSummary } from '../../infra/audit-model.js';
import type { AuditFinding, AuditReport } from '../../schemas/audit.js';

interface AuditOptions {
  scanners?: string;
  budget: string;
  provider?: string;
  model?: string;
  preset?: string;
  domains?: string;
  listPersonas?: boolean;
  localOnly?: boolean;
  forceFull?: boolean;
  maxFiles?: string;
  scannerTimeout?: string;
  aiContextBudget?: string;
  fix?: boolean;
  fixMax: string;
  fixMinSeverity: string;
  dryRun?: boolean;
  incremental?: boolean;
}

function renderAuditReport(report: AuditReport, durationMs: number): void {
  const counts = [
    report.criticalCount > 0 ? chalk.bgRed.white.bold(` ${report.criticalCount} critical `) : null,
    report.highCount > 0 ? chalk.red.bold(`${report.highCount} high`) : null,
    report.findings.filter((f) => f.severity === 'medium').length > 0
      ? chalk.yellow(`${report.findings.filter((f) => f.severity === 'medium').length} medium`) : null,
    report.findings.filter((f) => f.severity === 'low').length > 0
      ? chalk.gray(`${report.findings.filter((f) => f.severity === 'low').length} low`) : null,
  ].filter(Boolean);

  console.log('\n' + chalk.bold.cyan('Audit complete') + chalk.gray(` — ${report.totalFiles} files, ${(durationMs / 1000).toFixed(1)}s`));
  console.log(chalk.bold('Findings:') + '  ' + counts.join('  ') + chalk.dim(`  (${report.findings.length} total)`));
  console.log('  ' + chalk.dim(report.summary));

  if (report.topPriorities.length > 0) {
    console.log(chalk.bold('\nTop Priorities:'));
    report.topPriorities.slice(0, 3).forEach((p, i) => console.log(chalk.cyan(`  ${i + 1}.`) + ' ' + p));
    if (report.topPriorities.length > 3) console.log(chalk.dim(`  ... ${report.topPriorities.length - 3} more in HTML`));
  }
}

function renderDryRun(pipeline: AuditPipeline, stats: ReturnType<AuditPipeline['collectAuditStats']>, maxFilesForAi: number): void {
  console.log('\n' + chalk.bold.cyan('Audit dry run'));
  console.log(chalk.gray('No agents were started and no API tokens were used.'));
  console.log(`  total files seen: ${stats.totalFiles}`);
  console.log(`  audit source files: ${stats.auditFiles.length}`);
  console.log(`  AI target files: ${Math.min(stats.auditFiles.length, maxFilesForAi)} prioritized file(s)`);
  console.log(`  ignored directories: ${stats.ignoredDirs}`);
  console.log(`  ignored/non-source files: ${stats.ignoredFiles}`);
  console.log(`  oversized source files: ${stats.oversizedFiles}`);
  const exts = Object.entries(stats.byExtension).sort((a, b) => b[1] - a[1]);
  if (exts.length > 0) {
    console.log('\n' + chalk.bold('Extensions:'));
    exts.forEach(([ext, count]) => console.log(`  ${ext}: ${count}`));
  }
  if (stats.auditFiles.length > 0) {
    console.log('\n' + chalk.bold('AI target sample:'));
    pipeline.prioritizeFiles(stats.auditFiles, maxFilesForAi).slice(0, 15).forEach((file) => console.log(`  ${file}`));
  }
}

function parseBudget(value: string): 'low' | 'normal' | 'deep' {
  return (['low', 'normal', 'deep'].includes(value) ? value : 'low') as 'low' | 'normal' | 'deep';
}

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  return Math.max(1, Math.min(max, parseInt(String(value), 10) || fallback));
}

async function printPersonas(): Promise<void> {
  const { listPresets } = await import('../../infra/persona-presets.js');
  console.log(chalk.bold.cyan('\nPersonas (scanner domains):\n'));
  [
    'security', 'bugs', 'redundancy', 'error-handling', 'architecture', 'testing',
    'performance', 'infrastructure', 'observability', 'resilience', 'data',
    'dependencies', 'compliance', 'multitenancy', 'prompt-audit',
  ].forEach((d) => console.log(`  ${chalk.cyan(d)}`));
  listPresets();
}

async function maybeAutoFix(options: AuditOptions, report: AuditReport, orch: Orchestrator): Promise<void> {
  if (!options.fix) return;
  const maxFixes = parsePositiveInt(options.fixMax, 5, 20);
  const minSev = (['critical', 'high', 'medium'].includes(options.fixMinSeverity)
    ? options.fixMinSeverity : 'high') as 'critical' | 'high' | 'medium';
  const eligible = report.findings
    .filter((f: AuditFinding) => f.file && f.line && ((SEVERITY_RANK[f.severity] ?? 0) >= (SEVERITY_RANK[minSev] ?? 0)))
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
    .slice(0, maxFixes);

  if (options.dryRun) {
    console.log('\n' + chalk.bold.yellow(`Fix dry-run: ${eligible.length} finding(s) would be targeted.`));
    eligible.forEach((f, i) => console.log(`  ${i + 1}. ${f.severity} ${f.file}:${f.line} ${f.finding}`));
  } else if (report.criticalCount > 0 || report.highCount > 0 || minSev === 'medium') {
    console.log(chalk.bold.yellow(`\nAuto-fixing up to ${maxFixes} ${minSev}+ findings...\n`));
    const fixReport = await orch.runAuditFixPipeline(report, { maxFixes, minSeverity: minSev });
    console.log(chalk.bold(`Fix summary: ${fixReport.succeeded} fixed, ${fixReport.failed} failed, ${fixReport.skipped} skipped`));
  }
}

export function registerAudit(program: Command): void {
  program
    .command('audit [target]')
    .description('Deep audit with local scan, capped AI file scope, and compact reports')
    .option('-n, --scanners <n>', 'number of scanner agents (auto-selected if omitted)')
    .option('--budget <budget>', 'low | normal | deep (default: low)', 'low')
    .option('--provider <provider>', 'claude | openrouter (default: claude)')
    .option('--model <model>', 'model override for openrouter')
    .option('--preset <name>', 'persona preset: security, ai, backend, devops, quality, saas, fintech, full')
    .option('--domains <list>', 'comma-separated scanner domains')
    .option('--list-personas', 'show all available personas and presets then exit')
    .option('--local-only', 'run only deterministic local scans; no AI scanners or synthesizer')
    .option('--force-full', 'allow the full preset to start all requested AI scanner domains')
    .option('--max-files <n>', 'max prioritized source files sent to AI scanners')
    .option('--scanner-timeout <seconds>', 'timeout per AI scanner in seconds')
    .option('--ai-context-budget <tokens>', 'max approximate tokens for ai-context.md', '8000')
    .option('--fix', 'auto-fix critical/high findings after audit')
    .option('--fix-max <n>', 'max findings to auto-fix (default: 5)', '5')
    .option('--fix-min-severity <s>', 'minimum severity to fix: critical|high|medium (default: high)', 'high')
    .option('--dry-run', 'collect audit file stats without starting agents')
    .option('--incremental', 'only scan files changed since last audit')
    .action(async (target: string = '.', options: AuditOptions) => {
      if (options.listPersonas) return printPersonas();
      const { loadAionConfig, mergeConfig } = await import('../../infra/aion-config.js');
      const mergedOptions = mergeConfig(options as unknown as Record<string, unknown>, loadAionConfig(process.cwd())) as unknown as AuditOptions;
      const explicitN = mergedOptions.scanners ? Math.max(1, Math.min(15, parseInt(String(mergedOptions.scanners), 10) || 5)) : undefined;
      const budget = parseBudget(mergedOptions.budget);
      const scannerTimeoutSeconds = mergedOptions.scannerTimeout
        ? Math.max(10, Math.min(600, parseInt(String(mergedOptions.scannerTimeout), 10) || 90))
        : budget === 'deep' ? 240 : budget === 'normal' ? 150 : 90;
      const maxFilesForAi = parsePositiveInt(mergedOptions.maxFiles, budget === 'deep' ? 120 : budget === 'normal' ? 60 : 30, 500);
      const policyInput = {
        budget,
        ...(mergedOptions.model ? { openrouterModel: mergedOptions.model } : {}),
        ...(mergedOptions.provider === 'openrouter' ? { plannerProvider: 'openrouter' as const, investigatorProvider: 'openrouter' as const, developerProvider: 'openrouter' as const, reviewerProvider: 'openrouter' as const } : {}),
      };
      const policy = createRuntimePolicy(policyInput);
      if (options.dryRun) {
        const pipeline = new AuditPipeline(process.cwd(), policy, new CostTracker(), () => {}, () => {});
        renderDryRun(pipeline, pipeline.collectAuditStats(target), maxFilesForAi);
        return;
      }

      const renderer = new Renderer();
      const orch = new Orchestrator(process.cwd(), policyInput);
      orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
      orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
      orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));

      const { resolveDomainsFromConfig } = await import('../../infra/persona-presets.js');
      const { domains: explicitDomains, source: domainSource } = resolveDomainsFromConfig(process.cwd(), mergedOptions.preset, mergedOptions.domains, explicitN);
      const maxAiScanners = explicitN ?? policy.maxAgents;
      const requestsFullPreset = (mergedOptions.preset === 'full' && explicitN === undefined) || explicitDomains.length > maxAiScanners;
      if (requestsFullPreset && !mergedOptions.forceFull && !mergedOptions.localOnly) {
        console.error(chalk.red.bold('\nRefusing expensive full audit by default.\n'));
        console.error(chalk.gray(`Requested ${explicitDomains.length} domains, but ${budget} budget allows ${maxAiScanners} AI scanner(s).`));
        console.error(`  ${chalk.cyan('aion audit . --local-only')} no AI tokens`);
        console.error(`  ${chalk.cyan(`aion audit . --preset ${mergedOptions.preset ?? 'security'} --scanners ${maxAiScanners}`)} capped AI audit`);
        console.error(`  ${chalk.cyan('aion audit . --preset full --force-full')} explicit full-cost run`);
        process.exitCode = 1;
        return;
      }

      const label = mergedOptions.localOnly ? 'local-only scan (no AI tokens)'
        : explicitDomains.length > 0 ? `personas: ${explicitDomains.slice(0, maxAiScanners).join(', ')} [${domainSource}]`
        : explicitN ? `${explicitN} scanners` : `auto scanners (${budget} budget)`;
      console.log(chalk.bold.cyan(`\nStarting audit with ${label}...\n`));
      const start = Date.now();
      try {
        const report = await orch.runAuditPipeline(target, explicitN, explicitDomains.length > 0 ? explicitDomains : undefined, {
          incremental: options.incremental,
          localOnly: mergedOptions.localOnly,
          maxAiScanners: mergedOptions.forceFull ? explicitDomains.length || explicitN : maxAiScanners,
          maxFilesForAi,
          scannerTimeoutMs: scannerTimeoutSeconds * 1000,
        });
        const durationMs = Date.now() - start;
        renderAuditReport(report, durationMs);
        const costSummary: CostSummary = {
          totalUsd: orch.costs.totalUsd(),
          model: policy.claudeModel,
          perAgent: orch.costs.byAgent().map((e) => ({
            name: e.agentName,
            costUsd: e.costUsd,
            inputTokens: e.usage.inputTokens,
            outputTokens: e.usage.outputTokens,
          })),
        };
        const saved = saveAuditReport(process.cwd(), report, durationMs, parsePositiveInt(mergedOptions.aiContextBudget, 8000, 100000), costSummary);
        console.log(chalk.gray(`\nhtml: ${saved.html}`));
        console.log(chalk.gray(`dashboard: ${saved.runDir.replace(/audits[\\/][^\\/]+$/, 'index.html')}`));
        console.log(chalk.dim(orch.costs.summary()));
        await maybeAutoFix(options, report, orch);
        process.exit(report.criticalCount > 0 ? 2 : report.highCount > 0 ? 1 : 0);
      } catch (err) {
        renderer.showError(err);
        process.exit(1);
      }
    });
}
