import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative } from 'path';
import { isGeneratedArtifact, isIgnoredDirName } from '../cli/cli-utils.js';
import type { ApiEndpoint } from './code-metrics.js';

export interface PerformanceIssue {
  severity: 'high' | 'medium' | 'low';
  area: string;
  issue: string;
  recommendation: string;
}

export interface PerformanceReport {
  score: number;
  filesChecked: number;
  cacheSignals: number;
  asyncRiskSignals: number;
  bundleRisk: 'low' | 'medium' | 'unknown';
  unrateLimitedApis: number;
  issues: PerformanceIssue[];
}

const PERF_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rb', '.java']);

function walk(cwd: string): string[] {
  const files: string[] = [];
  const scan = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (isIgnoredDirName(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relative(cwd, full);
      if (entry.isDirectory()) { scan(full); continue; }
      if (isGeneratedArtifact(rel)) continue;
      if (PERF_EXTS.has(extname(entry.name))) files.push(rel);
    }
  };
  scan(cwd);
  return files.slice(0, 500);
}

function push(issues: PerformanceIssue[], severity: PerformanceIssue['severity'], area: string, issue: string, recommendation: string): void {
  issues.push({ severity, area, issue, recommendation });
}

function bundleRisk(cwd: string): PerformanceReport['bundleRisk'] {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return 'unknown';
  let pkg = '';
  try { pkg = readFileSync(pkgPath, 'utf8'); } catch { return 'unknown'; }
  if (/next|vite|webpack|rollup|astro|svelte|nuxt/i.test(pkg)) return 'medium';
  return 'low';
}

export function analyzePerformance(cwd: string, apiEndpoints: ApiEndpoint[]): PerformanceReport {
  const files = walk(cwd);
  let cacheSignals = 0;
  let asyncRiskSignals = 0;
  let nPlusOneSignals = 0;
  let syncIoSignals = 0;
  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }
    if (/cache-control|revalidate|stale-while-revalidate|redis|memcached|lru|cache\(/i.test(content)) cacheSignals++;
    if (/for\s*\([^)]*\)\s*{[^}]*await|for\s+.*:\s*.*\n\s+.*(query|find|get)\(/is.test(content)) { asyncRiskSignals++; nPlusOneSignals++; }
    if (/readFileSync|writeFileSync|execSync|spawnSync|requests\.get\(|urllib\.request/i.test(content)) { asyncRiskSignals++; syncIoSignals++; }
  }
  const issues: PerformanceIssue[] = [];
  const unrateLimitedApis = apiEndpoints.filter((endpoint) => !endpoint.hasRateLimit).length;
  if (unrateLimitedApis > 0) push(issues, 'medium', 'API pressure', `${unrateLimitedApis} endpoint(s) have no rate-limit signal`, 'Add throttling, cache policy, or abuse controls to public API routes.');
  if (cacheSignals === 0) push(issues, 'medium', 'Caching', 'No cache strategy signal detected', 'Define cache headers, data cache, or CDN strategy for read-heavy paths.');
  if (nPlusOneSignals > 0) push(issues, 'high', 'Database performance', `${nPlusOneSignals} possible looped query/await pattern(s)`, 'Batch reads, prefetch relations, or move fan-out work to jobs.');
  if (syncIoSignals > 0) push(issues, 'low', 'Runtime blocking', `${syncIoSignals} sync/blocking I/O signal(s)`, 'Avoid sync I/O on hot request paths and move heavy work off the event loop.');
  const risk = bundleRisk(cwd);
  if (risk === 'medium') push(issues, 'low', 'Bundle/runtime', 'Frontend bundler detected but no bundle budget validation', 'Add bundle-size or Lighthouse/PageSpeed budget checks for public pages.');
  const deduction = issues.reduce((sum, item) => sum + (item.severity === 'high' ? 20 : item.severity === 'medium' ? 10 : 4), 0);
  return {
    score: Math.max(0, 100 - deduction),
    filesChecked: files.length,
    cacheSignals,
    asyncRiskSignals,
    bundleRisk: risk,
    unrateLimitedApis,
    issues,
  };
}
