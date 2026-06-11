import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { HealthScore } from './health-score.js';
import type { SeoCrawlerReport } from './seo-analyzer.js';
import type { DatabaseReport } from './db-analyzer.js';
import type { PerformanceReport } from './performance-analyzer.js';
import type { LineSizeReport } from './line-size-analyzer.js';
import { AI_RUNTIME_DIR } from './paths.js';

export interface ProjectSnapshot {
  createdAt: string;
  health: number;
  grade: string;
  critical: number;
  high: number;
  seo: number;
  database: number;
  performance: number;
  oversizedFiles: number;
}

export interface ProjectTrend {
  previous?: ProjectSnapshot;
  current: ProjectSnapshot;
  changes: string[];
}

function historyPath(cwd: string): string {
  return join(cwd, AI_RUNTIME_DIR, 'reports', 'project-history.json');
}

function loadHistory(cwd: string): ProjectSnapshot[] {
  const file = historyPath(cwd);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as ProjectSnapshot[];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry.createdAt) : [];
  } catch {
    return [];
  }
}

function delta(label: string, current: number, previous: number, higherIsBetter = true): string | null {
  const diff = current - previous;
  if (diff === 0) return null;
  const direction = diff > 0 ? 'increased' : 'decreased';
  const good = higherIsBetter ? diff > 0 : diff < 0;
  return `${label} ${direction} by ${Math.abs(diff)} (${previous} -> ${current})${good ? '' : ' - needs attention'}`;
}

export function buildProjectTrend(input: {
  cwd: string;
  generatedAt: string;
  health: HealthScore;
  auditCriticals: number;
  auditHighs: number;
  seo: SeoCrawlerReport;
  database: DatabaseReport;
  performance: PerformanceReport;
  lineSize: LineSizeReport;
}): ProjectTrend {
  const current: ProjectSnapshot = {
    createdAt: input.generatedAt,
    health: input.health.total,
    grade: input.health.grade,
    critical: input.auditCriticals,
    high: input.auditHighs,
    seo: input.seo.score,
    database: input.database.score,
    performance: input.performance.score,
    oversizedFiles: input.lineSize.oversized.length,
  };
  const history = loadHistory(input.cwd);
  const previous = history.length ? history[history.length - 1] : undefined;
  const changes = previous ? [
    delta('Health score', current.health, previous.health),
    current.grade !== previous.grade ? `Grade changed ${previous.grade} -> ${current.grade}` : null,
    delta('Critical findings', current.critical, previous.critical, false),
    delta('High findings', current.high, previous.high, false),
    delta('SEO/crawler score', current.seo, previous.seo),
    delta('Database score', current.database, previous.database),
    delta('Performance score', current.performance, previous.performance),
    delta('Oversized source files', current.oversizedFiles, previous.oversizedFiles, false),
  ].filter(Boolean) as string[] : ['No previous project snapshot yet. This run becomes the baseline.'];
  return { previous, current, changes };
}

export function saveProjectTrend(cwd: string, snapshot: ProjectSnapshot): void {
  const history = loadHistory(cwd).filter((entry) => entry.createdAt !== snapshot.createdAt);
  history.push(snapshot);
  writeFileSync(historyPath(cwd), JSON.stringify(history.slice(-30), null, 2), 'utf8');
}

export function renderTrendMarkdown(trend: ProjectTrend): string {
  const changes = trend.changes.length ? trend.changes : ['No score changes since the previous project snapshot.'];
  return ['## What Changed Since Last Run', ...changes.map((change) => `- ${change}`)].join('\n');
}

export function renderTrendHtml(trend: ProjectTrend): string {
  const changes = trend.changes.length ? trend.changes : ['No score changes since the previous project snapshot.'];
  const rows = changes.map((change) => `<li>${change.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</li>`).join('');
  return `<section id="trend"><h2>What Changed Since Last Run</h2><ul>${rows}</ul></section>`;
}
