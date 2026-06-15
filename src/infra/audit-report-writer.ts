import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AuditReport } from '../schemas/audit.js';
import { saveDomainSnapshot, projectReportPath } from './project-report.js';
import { AI_RUNTIME_DIR } from './paths.js';
import {
  renderAiContext,
  renderDigest,
  type FullSavedAuditReport,
  type SavedAuditPaths,
  type CostSummary,
  type AuditHistoryEntry,
} from './audit-model.js';
import { renderHtml, renderDashboardHtml } from './audit-report-html.js';

export const DEFAULT_AI_CONTEXT_BUDGET = 8000;

function updateAuditHistory(reportsDir: string, entry: AuditHistoryEntry): AuditHistoryEntry[] {
  const historyFile = join(reportsDir, 'audit-history.json');
  let history: AuditHistoryEntry[] = [];
  if (existsSync(historyFile)) {
    try { history = JSON.parse(readFileSync(historyFile, 'utf8')) as AuditHistoryEntry[]; } catch { /* ignore */ }
  }
  history.push(entry);
  if (history.length > 50) history = history.slice(-50);
  writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf8');
  return history;
}

export function saveAuditReport(
  cwd: string,
  report: AuditReport,
  durationMs: number,
  aiContextBudget = DEFAULT_AI_CONTEXT_BUDGET,
  costSummary?: CostSummary,
): SavedAuditPaths {
  const dir = join(cwd, AI_RUNTIME_DIR, 'reports');
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const createdAt = now.toISOString();
  const fullReport: FullSavedAuditReport = { ...report, durationMs, createdAt, costSummary };
  const runDir = join(dir, 'audits', stamp);
  mkdirSync(runDir, { recursive: true });

  const paths: SavedAuditPaths = {
    runDir,
    html: join(runDir, 'index.html'),
    digest: join(runDir, 'digest.md'),
    aiContext: join(runDir, 'ai-context.md'),
    report: join(runDir, 'report.json'),
    dashboard: join(dir, 'index.html'),
    project: projectReportPath(cwd),
  };

  const history = updateAuditHistory(dir, {
    stamp,
    createdAt,
    runRelDir: `audits/${stamp}`,
    criticalCount: report.criticalCount,
    highCount: report.highCount,
    totalFiles: report.totalFiles,
    durationMs,
    costUsd: costSummary?.totalUsd ?? 0,
  });

  writeFileSync(paths.report, JSON.stringify(fullReport, null, 2), 'utf8');
  writeFileSync(paths.digest, renderDigest(fullReport), 'utf8');
  writeFileSync(paths.aiContext, renderAiContext(fullReport, aiContextBudget), 'utf8');
  writeFileSync(paths.html, renderHtml(fullReport, history), 'utf8');
  writeFileSync(join(dir, 'index.html'), renderDashboardHtml(history), 'utf8');
  writeFileSync(join(dir, 'latest-audit.json'), JSON.stringify({
    runDir: paths.runDir,
    html: paths.html,
    digest: paths.digest,
    aiContext: paths.aiContext,
    report: paths.report,
    dashboard: paths.dashboard,
    project: paths.project,
    createdAt,
  }, null, 2), 'utf8');
  saveDomainSnapshot(cwd, report);
  return { ...paths, project: projectReportPath(cwd) };
}
