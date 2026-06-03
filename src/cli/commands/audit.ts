import type { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Orchestrator } from '../../core/orchestrator.js';
import { AuditPipeline } from '../../core/pipelines/audit-pipeline.js';
import { createRuntimePolicy } from '../../core/runtime-policy.js';
import { CostTracker } from '../../core/cost-tracker.js';
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

  // Findings: if sections exist, render by domain; otherwise by severity
  const auditReport = report as import('../../schemas/audit.js').AuditReport;
  if (auditReport.sections && auditReport.sections.length > 0) {
    for (const section of auditReport.sections) {
      if (section.findings.length === 0) continue;
      console.log('\n' + chalk.bold.blue(`  ▸ ${section.domain.toUpperCase()} (${section.findings.length})`));
      for (const f of section.findings) {
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        const color = SEVERITY_COLOR[f.severity] ?? chalk.white;
        console.log(color(`  ${loc}`) + chalk.gray(` [${f.severity}]`));
        console.log(`    ${f.finding}`);
        console.log(chalk.dim(`    → ${f.recommendation}`));
        console.log();
      }
    }
  } else {
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
  }

  console.log(chalk.bold('═'.repeat(60)));
}

function saveAuditReport(report: {
  findings: AuditFinding[];
  criticalCount: number;
  highCount: number;
  totalFiles: number;
  summary: string;
  topPriorities: string[];
}, durationMs: number): string {
  const dir = join(process.cwd(), '.ai-runtime', 'reports');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `audit-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ ...report, durationMs, createdAt: new Date().toISOString() }, null, 2), 'utf8');
  return file;
}

function renderDryRun(stats: ReturnType<AuditPipeline['collectAuditStats']>): void {
  console.log('\n' + chalk.bold.cyan('Audit dry run'));
  console.log(chalk.gray('No agents were started and no API tokens were used.'));
  console.log(`  total files seen: ${stats.totalFiles}`);
  console.log(`  audit source files: ${stats.auditFiles.length}`);
  console.log(`  ignored directories: ${stats.ignoredDirs}`);
  console.log(`  ignored/non-source files: ${stats.ignoredFiles}`);
  console.log(`  oversized source files: ${stats.oversizedFiles}`);

  const exts = Object.entries(stats.byExtension).sort((a, b) => b[1] - a[1]);
  if (exts.length > 0) {
    console.log('\n' + chalk.bold('Extensions:'));
    exts.forEach(([ext, count]) => console.log(`  ${ext}: ${count}`));
  }

  if (stats.auditFiles.length > 0) {
    console.log('\n' + chalk.bold('Sample:'));
    stats.auditFiles.slice(0, 10).forEach((file) => console.log(`  ${file}`));
  }
}

export function registerAudit(program: Command): void {
  program
    .command('audit [target]')
    .description('Deep parallel audit: N scanners cover all files, synthesizer unifies findings')
    .option('-n, --scanners <n>', 'number of scanner agents (auto-selected if omitted)')
    .option('--budget <budget>', 'low | normal | deep (default: low)', 'low')
    .option('--provider <provider>', 'claude | openrouter (default: claude)')
    .option('--model <model>', 'model override for openrouter (e.g. moonshotai/kimi-k2)')
    .option('--preset <name>', 'persona preset: security, ai, backend, devops, quality, saas, fintech, full')
    .option('--domains <list>', 'comma-separated scanner domains, e.g. security,compliance,data')
    .option('--list-personas', 'show all available personas and presets then exit')
    .option('--fix', 'auto-fix critical/high findings after audit')
    .option('--fix-max <n>', 'max findings to auto-fix (default: 5)', '5')
    .option('--fix-min-severity <s>', 'minimum severity to fix: critical|high|medium (default: high)', 'high')
    .option('--dry-run', 'collect audit file stats without starting agents')
    .option('--incremental', 'only scan files changed since last audit (reuse cache for unchanged)')
    .action(async (target: string = '.', options: { scanners?: string; budget: string; provider?: string; model?: string; preset?: string; domains?: string; listPersonas?: boolean; fix?: boolean; fixMax: string; fixMinSeverity: string; dryRun?: boolean; incremental?: boolean }) => {
      if (options.listPersonas) {
        const { listPresets, BUILT_IN_PRESETS } = await import('../../infra/persona-presets.js');
        console.log(chalk.bold.cyan('\nPersonas (scanner domains):\n'));
        const allDomains = [
          'security','bugs','redundancy','error-handling','architecture','testing','performance',
          'infrastructure','observability','resilience','data','dependencies','compliance','multitenancy','prompt-audit',
        ];
        allDomains.forEach((d) => console.log(`  ${chalk.cyan(d)}`));
        listPresets();
        return;
      }

      // Merge .aionrc.json config under CLI options
      const { loadAionConfig, mergeConfig } = await import('../../infra/aion-config.js');
      const aionConfig = loadAionConfig(process.cwd());
      const mergedOptions = mergeConfig(options as Record<string, unknown>, aionConfig) as typeof options;

      const explicitN = mergedOptions.scanners ? Math.max(1, Math.min(15, parseInt(String(mergedOptions.scanners), 10) || 5)) : undefined;
      const budget = (['low', 'normal', 'deep'].includes(mergedOptions.budget) ? mergedOptions.budget : 'low') as 'low' | 'normal' | 'deep';
      const providerName = mergedOptions.provider === 'openrouter' ? 'openrouter' as const : undefined;
      const policyInput = {
        budget,
        ...(mergedOptions.model ? { openrouterModel: mergedOptions.model } : {}),
        ...(providerName ? {
          plannerProvider: providerName,
          investigatorProvider: providerName,
          developerProvider: providerName,
          reviewerProvider: providerName,
        } : {}),
      };
      const policy = createRuntimePolicy(policyInput);
      const renderer = new Renderer();
      const orch = new Orchestrator(process.cwd(), policyInput);

      if (options.dryRun) {
        const pipeline = new AuditPipeline(process.cwd(), policy, new CostTracker(), () => {}, () => {});
        renderDryRun(pipeline.collectAuditStats(target));
        return;
      }

      orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
      orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
      orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));

      // Resolve persona domains
      const { resolveDomainsFromConfig } = await import('../../infra/persona-presets.js');
      const { domains: explicitDomains, source: domainSource } = resolveDomainsFromConfig(
        process.cwd(), mergedOptions.preset, mergedOptions.domains, explicitN,
      );

      const start = Date.now();
      const nLabel = explicitDomains.length > 0
        ? `personas: ${explicitDomains.join(', ')} [${domainSource}]`
        : explicitN ? `${explicitN} scanners` : `auto scanners (${budget} budget)`;
      console.log(chalk.bold.cyan(`\nStarting audit with ${nLabel}...\n`));

      try {
        const report = await orch.runAuditPipeline(target, explicitN, explicitDomains.length > 0 ? explicitDomains : undefined, options.incremental);
        const durationMs = Date.now() - start;
        renderAuditReport(report, durationMs);
        console.log(chalk.gray(`report: ${saveAuditReport(report, durationMs)}`));
        console.log(chalk.dim(orch.costs.summary()));

        if (options.fix) {
          const maxFixes = Math.max(1, Math.min(20, parseInt(options.fixMax, 10) || 5));
          const minSev = (['critical', 'high', 'medium'].includes(options.fixMinSeverity)
            ? options.fixMinSeverity : 'high') as 'critical' | 'high' | 'medium';

          const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
          const eligible = report.findings
            .filter((f) => f.file && f.line && ((SEVERITY_RANK[f.severity] ?? 0) >= (SEVERITY_RANK[minSev] ?? 0)))
            .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
            .slice(0, maxFixes);

          if (options.dryRun) {
            // Dry-run: show what would be fixed without running
            console.log('\n' + chalk.bold.yellow(`Fix dry-run — ${eligible.length} finding(s) would be targeted (up to ${maxFixes}, severity ≥ ${minSev}):\n`));
            if (eligible.length === 0) {
              console.log(chalk.dim('  No eligible findings (need file+line and severity ≥ ' + minSev + ')'));
            } else {
              eligible.forEach((f, i) => {
                const loc = f.line ? `${f.file}:${f.line}` : f.file;
                const sev = SEVERITY_COLOR[f.severity]?.(f.severity) ?? chalk.white(f.severity);
                console.log(`  ${i + 1}. ${sev}  ${chalk.bold(loc)}`);
                console.log(`     ${f.finding}`);
                console.log(chalk.dim(`     → ${f.recommendation}`));
                console.log();
              });
            }
            const skipped = report.findings.length - eligible.length;
            if (skipped > 0) console.log(chalk.dim(`  ${skipped} finding(s) skipped (below threshold or missing file+line)`));
          } else if (report.criticalCount > 0 || report.highCount > 0 || minSev === 'medium') {
            console.log(chalk.bold.yellow(`\nAuto-fixing up to ${maxFixes} ${minSev}+ findings...\n`));
            const fixReport = await orch.runAuditFixPipeline(report, { maxFixes, minSeverity: minSev });
            console.log(chalk.bold(`Fix summary: ${fixReport.succeeded} fixed, ${fixReport.failed} failed, ${fixReport.skipped} skipped`));
          }
        }

        process.exit(report.criticalCount > 0 ? 2 : report.highCount > 0 ? 1 : 0);
      } catch (err) {
        renderer.showError(err);
        process.exit(1);
      }
    });
}
