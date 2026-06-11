import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import chalk from 'chalk';
import { AI_RUNTIME_DIR } from './paths.js';

const TREND_FILE = join(AI_RUNTIME_DIR, 'health-trend.json');
const MAX_ENTRIES = 90;

export interface TrendEntry {
  timestamp: string;
  gitSha?: string;
  gitBranch?: string;
  score: number;
  grade: string;
  dimensions: Record<string, number>;
  totalFiles?: number;
}

export interface HealthTrend {
  version: 1;
  entries: TrendEntry[];
}

export function loadTrend(cwd: string): HealthTrend {
  const path = join(cwd, TREND_FILE);
  if (!existsSync(path)) return { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HealthTrend;
    if (parsed.version !== 1) return { version: 1, entries: [] };
    return parsed;
  } catch { return { version: 1, entries: [] }; }
}

export function appendTrend(cwd: string, entry: Omit<TrendEntry, 'gitSha' | 'gitBranch'>): void {
  const trend = loadTrend(cwd);

  let gitSha: string | undefined;
  let gitBranch: string | undefined;
  try {
    gitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    gitBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch { /* not a git repo */ }

  trend.entries.push({ ...entry, gitSha, gitBranch });
  if (trend.entries.length > MAX_ENTRIES) {
    trend.entries = trend.entries.slice(trend.entries.length - MAX_ENTRIES);
  }

  mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
  writeFileSync(join(cwd, TREND_FILE), JSON.stringify(trend, null, 2), 'utf8');
}

function downsample(entries: TrendEntry[], width: number): TrendEntry[] {
  if (entries.length <= width) return entries;
  const result: TrendEntry[] = [];
  const step = entries.length / width;
  for (let i = 0; i < width; i++) {
    const idx = Math.min(Math.round(i * step), entries.length - 1);
    result.push(entries[idx]!);
  }
  return result;
}

function colorScore(score: number, text?: string): string {
  const label = text ?? `${score}/100`;
  if (score >= 85) return chalk.green(label);
  if (score >= 70) return chalk.yellow(label);
  return chalk.red(label);
}

function colorDot(score: number): string {
  if (score >= 85) return chalk.green('●');
  if (score >= 70) return chalk.yellow('●');
  return chalk.red('●');
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  } catch { return iso.slice(5, 10); }
}

export function renderTrendChart(entries: TrendEntry[]): void {
  if (entries.length === 0) {
    console.log(chalk.dim('  No trend data yet. Run `aion health` a few times to build history.'));
    return;
  }

  const CHART_WIDTH = 50;
  const CHART_HEIGHT = 10;

  const scores = entries.map((e) => e.score);
  const minScore = Math.max(0, Math.min(...scores) - 5);
  const maxScore = Math.min(100, Math.max(...scores) + 5);
  const range = maxScore - minScore || 1;

  const sampled = downsample(entries, CHART_WIDTH);

  // Build grid: rows from top (high score) to bottom (low score)
  const grid: Array<Array<{ char: string; score: number }>> = Array.from(
    { length: CHART_HEIGHT },
    () => Array.from({ length: sampled.length }, () => ({ char: ' ', score: 0 })),
  );

  for (let col = 0; col < sampled.length; col++) {
    const e = sampled[col]!;
    const rowF = ((e.score - minScore) / range) * (CHART_HEIGHT - 1);
    const row = Math.max(0, Math.min(CHART_HEIGHT - 1, CHART_HEIGHT - 1 - Math.round(rowF)));
    grid[row]![col] = { char: '●', score: e.score };
  }

  console.log('');
  for (let row = 0; row < CHART_HEIGHT; row++) {
    const scoreAtRow = Math.round(maxScore - (row / (CHART_HEIGHT - 1)) * range);
    const label = (row === 0 || row === CHART_HEIGHT - 1) ? String(scoreAtRow).padStart(3) : '   ';
    const line = grid[row]!.map((cell) =>
      cell.char === '●' ? colorDot(cell.score) : chalk.dim('·'),
    ).join('');
    process.stdout.write(`  ${chalk.dim(label)} │${line}\n`);
  }

  const axis = '─'.repeat(sampled.length);
  console.log(`       └${axis}`);

  const first = formatDate(sampled[0]!.timestamp);
  const last = formatDate(sampled[sampled.length - 1]!.timestamp);
  const pad = Math.max(0, sampled.length - first.length - last.length);
  console.log(`        ${chalk.dim(first)}${' '.repeat(pad)}${chalk.dim(last)}`);
  console.log('');

  const latest = entries[entries.length - 1]!;
  const prev = entries.length > 1 ? entries[entries.length - 2] : null;
  const delta = prev ? latest.score - prev.score : 0;
  const deltaStr = delta > 0 ? chalk.green(`+${delta}`) : delta < 0 ? chalk.red(String(delta)) : chalk.gray('±0');
  const trendIcon = delta > 2 ? chalk.green('↑') : delta < -2 ? chalk.red('↓') : chalk.gray('→');
  console.log(`  Latest: ${colorScore(latest.score)} grade ${latest.grade}  ${trendIcon} ${deltaStr} vs prev  (${entries.length} data points)`);
}
