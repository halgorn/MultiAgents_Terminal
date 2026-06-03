import { spawnSync } from 'child_process';

export interface ChurnEntry {
  file: string;
  commits: number;
  authors: number;
  lastChanged: string;
  risk: 'critical' | 'high' | 'medium' | 'low';
}

export interface BusFactorEntry {
  file: string;
  primaryAuthor: string;
  primaryPercent: number;
  totalAuthors: number;
  risk: 'critical' | 'high' | 'medium' | 'low';
}

export interface ChurnReport {
  churn: ChurnEntry[];
  busFactor: BusFactorEntry[];
  totalCommits: number;
  periodDays: number;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return '';
  return result.stdout ?? '';
}

function isGitRepo(cwd: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8', timeout: 5000 });
  return result.status === 0;
}

export function analyzeChurn(cwd: string, days = 90, limit = 30): ChurnEntry[] {
  if (!isGitRepo(cwd)) return [];

  const out = git(cwd, [
    'log', '--name-only', `--pretty=format:AUTHOR:%ae|DATE:%ad`,
    '--date=short', `--since=${days}.days.ago`, '--diff-filter=M',
  ]);

  const fileData = new Map<string, { commits: number; authors: Set<string>; last: string }>();
  let currentAuthor = '';
  let currentDate = '';

  for (const line of out.split('\n')) {
    if (line.startsWith('AUTHOR:')) {
      const parts = line.slice(7).split('|DATE:');
      currentAuthor = parts[0]?.trim() ?? '';
      currentDate = parts[1]?.trim() ?? '';
      continue;
    }
    const file = line.trim();
    if (!file) continue;
    const entry = fileData.get(file) ?? { commits: 0, authors: new Set<string>(), last: '' };
    entry.commits++;
    if (currentAuthor) entry.authors.add(currentAuthor);
    if (!entry.last && currentDate) entry.last = currentDate;
    fileData.set(file, entry);
  }

  return [...fileData.entries()]
    .sort((a, b) => b[1].commits - a[1].commits)
    .slice(0, limit)
    .map(([file, data]) => ({
      file,
      commits: data.commits,
      authors: data.authors.size,
      lastChanged: data.last,
      risk: data.commits >= 15 ? 'critical'
        : data.commits >= 8 ? 'high'
        : data.commits >= 4 ? 'medium'
        : 'low',
    }));
}

export function analyzeBusFactor(cwd: string, files: string[], days = 180): BusFactorEntry[] {
  if (!isGitRepo(cwd)) return [];
  const results: BusFactorEntry[] = [];

  for (const file of files.slice(0, 40)) {
    const out = git(cwd, ['log', '--format=%ae', `--since=${days}.days.ago`, '--', file]);
    const emails = out.split('\n').map((e) => e.trim()).filter(Boolean);
    if (emails.length < 2) continue;

    const counts = new Map<string, number>();
    for (const e of emails) counts.set(e, (counts.get(e) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const [primary, primaryCount] = sorted[0] ?? ['unknown', 0];
    const primaryPercent = Math.round((primaryCount / emails.length) * 100);

    results.push({
      file,
      primaryAuthor: primary,
      primaryPercent,
      totalAuthors: counts.size,
      risk: counts.size === 1 ? 'critical'
        : primaryPercent >= 85 ? 'high'
        : primaryPercent >= 65 ? 'medium'
        : 'low',
    });
  }

  return results.sort((a, b) => b.primaryPercent - a.primaryPercent);
}

export function totalCommits(cwd: string, days = 90): number {
  if (!isGitRepo(cwd)) return 0;
  const out = git(cwd, ['log', '--oneline', `--since=${days}.days.ago`]);
  return out.split('\n').filter(Boolean).length;
}

export function gitAuthors(cwd: string): string[] {
  if (!isGitRepo(cwd)) return [];
  const out = git(cwd, ['log', '--format=%ae', '--since=180.days.ago']);
  return [...new Set(out.split('\n').map((e) => e.trim()).filter(Boolean))];
}

export function buildChurnReport(cwd: string, hotspotFiles: string[], days = 90): ChurnReport {
  const churn = analyzeChurn(cwd, days);
  const topFiles = hotspotFiles.length > 0 ? hotspotFiles : churn.map((c) => c.file);
  const busFactor = analyzeBusFactor(cwd, topFiles);
  return { churn, busFactor, totalCommits: totalCommits(cwd, days), periodDays: days };
}
