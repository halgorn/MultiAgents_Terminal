import type { Command } from 'commander';
import { Orchestrator } from '../../core/orchestrator.js';
import { AuditPipeline } from '../../core/pipelines/audit-pipeline.js';
import { createRuntimePolicy } from '../../core/runtime-policy.js';
import { CostTracker } from '../../core/cost-tracker.js';
import { saveAuditReport } from '../../infra/audit-report-writer.js';
import { SEVERITY_RANK, type CostSummary } from '../../infra/audit-model.js';
import { SEVERITY_ORDER, type Severity } from '../../schemas/audit.js';
import { parseBudget } from '../cli-utils.js';
import { buildAssistPlan, saveAssistPlan } from '../../infra/assist/assist-plan.js';
import { applyArtifacts, formatArtifactSummary } from '../../infra/assist/apply-artifacts.js';

type FailSeverity = Exclude<Severity, 'info'>;
const SEVERITY_LEVELS = SEVERITY_ORDER.filter((s): s is FailSeverity => s !== 'info');

interface CiOptions {
  budget: string;
  preset?: string;
  domains?: string;
  scanners?: string;
  failOn: string;
  maxFiles?: string;
  localOnly?: boolean;
  format: string;
  dryRun?: boolean;
}

function parseFailOn(v: string): FailSeverity {
  return (SEVERITY_LEVELS.includes(v as FailSeverity) ? v : 'high') as FailSeverity;
}

export function registerCi(program: Command): void {
  const ci = program
    .command('ci [target]')
    .description('CI-mode audit: structured output + exit codes (0=clean, 1=high, 2=critical)')
    .option('--budget <budget>', 'low | normal | deep', 'low')
    .option('--preset <name>', 'persona preset')
    .option('--domains <list>', 'comma-separated scanner domains')
    .option('-n, --scanners <n>', 'number of scanner agents')
    .option('--fail-on <severity>', 'exit non-zero if findings at or above this severity (default: high)', 'high')
    .option('--max-files <n>', 'max source files sent to AI scanners')
    .option('--local-only', 'deterministic scans only; no AI tokens')
    .option('--format <fmt>', 'output format: json | text (default: json)', 'json')
    .option('--dry-run', 'show file stats + cost estimate, no agents')
    .action(async (target: string = '.', options: CiOptions) => {
      const budget = parseBudget(options.budget);
      const failOn = parseFailOn(options.failOn);
      const failRank = SEVERITY_RANK[failOn] ?? 3;
      const maxFilesForAi = options.maxFiles
        ? Math.max(1, Math.min(500, parseInt(options.maxFiles, 10) || 30))
        : budget === 'deep' ? 120 : budget === 'normal' ? 60 : 30;

      const policy = createRuntimePolicy({ budget });

      if (options.dryRun) {
        const pipeline = new AuditPipeline(process.cwd(), policy, new CostTracker(), () => {}, () => {});
        const stats = pipeline.collectAuditStats(target);
        const { SessionBudget } = await import('../../core/cost-tracker.js');
        const sessionBudget = new SessionBudget(process.cwd(), policy.claudeMaxBudgetUsd);
        const { resolveDomainsFromConfig } = await import('../../infra/persona-presets.js');
        const { domains } = resolveDomainsFromConfig(process.cwd(), options.preset, options.domains, undefined);
        const nScanners = Math.min(domains.length || policy.maxAgents, policy.maxAgents);
        const estimated = sessionBudget.estimatedCost(nScanners, policy.claudeModel);

        if (options.format === 'json') {
          process.stdout.write(JSON.stringify({
            dryRun: true,
            totalFiles: stats.totalFiles,
            auditFiles: stats.auditFiles.length,
            aiTargetFiles: Math.min(stats.auditFiles.length, maxFilesForAi),
            estimatedCostUsd: parseFloat(estimated.toFixed(4)),
            scanners: nScanners,
            budget,
          }, null, 2) + '\n');
        } else {
          process.stdout.write(`DRY RUN\n`);
          process.stdout.write(`  files: ${stats.auditFiles.length} source / ${stats.totalFiles} total\n`);
          process.stdout.write(`  AI target: ${Math.min(stats.auditFiles.length, maxFilesForAi)} files\n`);
          process.stdout.write(`  scanners: ${nScanners}\n`);
          process.stdout.write(`  estimated cost: $${estimated.toFixed(4)}\n`);
        }
        return;
      }

      const allOutput: string[] = [];
      const orch = new Orchestrator(process.cwd(), { budget });
      if (options.format === 'text') {
        orch.on('agent:output', ({ text }: { text: string }) => process.stderr.write(text));
      }

      const { resolveDomainsFromConfig } = await import('../../infra/persona-presets.js');
      const explicitN = options.scanners ? Math.max(1, Math.min(15, parseInt(options.scanners, 10) || 5)) : undefined;
      const { domains: explicitDomains } = resolveDomainsFromConfig(process.cwd(), options.preset, options.domains, explicitN);

      const start = Date.now();
      try {
        const report = await orch.runAuditPipeline(target, explicitN, explicitDomains.length > 0 ? explicitDomains : undefined, {
          localOnly: options.localOnly,
          maxFilesForAi,
        });
        const durationMs = Date.now() - start;

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
        const saved = saveAuditReport(process.cwd(), report, durationMs, 8000, costSummary);

        const failingFindings = report.findings.filter((f) => (SEVERITY_RANK[f.severity] ?? 0) >= failRank);

        if (options.format === 'json') {
          process.stdout.write(JSON.stringify({
            passed: failingFindings.length === 0,
            failOn,
            summary: report.summary,
            totalFiles: report.totalFiles,
            durationMs,
            costUsd: costSummary.totalUsd,
            counts: {
              total: report.findings.length,
              critical: report.criticalCount,
              high: report.highCount,
            },
            topPriorities: report.topPriorities.slice(0, 5),
            findings: report.findings.slice(0, 50).map((f) => ({
              severity: f.severity,
              file: f.file,
              line: f.line,
              category: f.category,
              finding: f.finding,
              recommendation: f.recommendation,
            })),
            reports: { html: saved.html, dashboard: saved.dashboard },
          }, null, 2) + '\n');
        } else {
          process.stdout.write(`AUDIT RESULT: ${failingFindings.length === 0 ? 'PASS' : 'FAIL'}\n`);
          process.stdout.write(`  findings: ${report.findings.length} (${report.criticalCount} critical, ${report.highCount} high)\n`);
          process.stdout.write(`  cost: $${costSummary.totalUsd.toFixed(4)} | duration: ${(durationMs / 1000).toFixed(1)}s\n`);
          process.stdout.write(`  html: ${saved.html}\n`);
          if (failingFindings.length > 0) {
            process.stdout.write(`\nFailing findings (${failOn}+):\n`);
            failingFindings.slice(0, 20).forEach((f, i) => {
              process.stdout.write(`  ${i + 1}. [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.finding}\n`);
            });
          }
        }

        void allOutput;
        process.exit(report.criticalCount > 0 ? 2 : failingFindings.length > 0 ? 1 : 0);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (options.format === 'json') {
          process.stdout.write(JSON.stringify({ passed: false, error: msg }) + '\n');
        } else {
          process.stderr.write(`ERROR: ${msg}\n`);
        }
        process.exit(3);
      }
    });

  ci
    .command('assist')
    .description('Generate GitHub Actions CI workflow with Aion local scans')
    .option('--dry-run', 'show planned writes only', true)
    .option('--apply', 'write generated workflow')
    .option('--overwrite', 'overwrite existing workflow')
    .option('--seo-fail-under <score>', 'fail CI when SEO score is below this threshold')
    .action((options: { dryRun?: boolean; apply?: boolean; overwrite?: boolean; seoFailUnder?: string }) => {
      const seo = options.seoFailUnder ? Math.max(0, Math.min(100, parseInt(options.seoFailUnder, 10) || 0)) : undefined;
      const plan = buildAssistPlan(process.cwd(), { mode: 'ci', ciSeoFailUnder: seo });
      const ciOnly = {
        ...plan,
        artifacts: plan.artifacts.filter((artifact) => artifact.path.includes('aion-ci.yml') || artifact.path.endsWith('README.md')),
        remoteSteps: [],
      };
      const planPath = saveAssistPlan(process.cwd(), ciOnly);
      const result = applyArtifacts(process.cwd(), ciOnly, { dryRun: !options.apply, overwrite: options.overwrite });
      process.stdout.write(`Assist plan: ${planPath}\n`);
      process.stdout.write(formatArtifactSummary(result) + '\n');
      if (!options.apply) process.stdout.write('Dry-run only. Re-run with --apply to write files.\n');
    });
}
