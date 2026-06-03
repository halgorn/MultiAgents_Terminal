import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface SbomPackage {
  name: string;
  version: string;
  lang: 'python' | 'node' | 'go' | 'rust' | 'java' | 'unknown';
  pinned: boolean;
  source: string;
}

export interface SbomReport {
  packages: SbomPackage[];
  unpinned: SbomPackage[];
  totalCount: number;
  langs: string[];
}

function parsePythonRequirements(content: string, source: string): SbomPackage[] {
  const pkgs: SbomPackage[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*([=<>!~]{1,2}\s*[\w.*]+)?/.exec(trimmed);
    if (!match) continue;
    const name = match[1]!;
    const versionSpec = match[2]?.trim() ?? '';
    const pinned = versionSpec.startsWith('==');
    const version = versionSpec.replace(/^==/, '').trim() || 'unspecified';
    pkgs.push({ name, version, lang: 'python', pinned, source });
  }
  return pkgs;
}

function parseNodePackageJson(content: string, source: string): SbomPackage[] {
  const pkgs: SbomPackage[] = [];
  try {
    const json = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...json.dependencies, ...json.devDependencies };
    for (const [name, version] of Object.entries(allDeps)) {
      const pinned = !version.startsWith('^') && !version.startsWith('~') && !version.startsWith('*') && version !== 'latest';
      pkgs.push({ name, version, lang: 'node', pinned, source });
    }
  } catch { /* invalid JSON */ }
  return pkgs;
}

function parseGoMod(content: string, source: string): SbomPackage[] {
  const pkgs: SbomPackage[] = [];
  for (const line of content.split('\n')) {
    const match = /^\s+([^\s]+)\s+v([^\s]+)/.exec(line);
    if (!match) continue;
    pkgs.push({ name: match[1]!, version: `v${match[2]}`, lang: 'go', pinned: true, source });
  }
  return pkgs;
}

function parseCargoToml(content: string, source: string): SbomPackage[] {
  const pkgs: SbomPackage[] = [];
  let inDeps = false;
  for (const line of content.split('\n')) {
    if (/^\[(?:dependencies|dev-dependencies|build-dependencies)\]/.test(line)) { inDeps = true; continue; }
    if (/^\[/.test(line) && !/dependencies/.test(line)) { inDeps = false; continue; }
    if (!inDeps) continue;
    const match = /^([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]+)"|version\s*=\s*"([^"]+)")/.exec(line.trim());
    if (!match) continue;
    const version = match[2] ?? match[3] ?? 'unspecified';
    const pinned = /^\d+\.\d+\.\d+$/.test(version);
    pkgs.push({ name: match[1]!, version, lang: 'rust', pinned, source });
  }
  return pkgs;
}

export function buildSbom(cwd: string): SbomReport {
  const packages: SbomPackage[] = [];
  const parsers: Array<[string, (c: string, s: string) => SbomPackage[]]> = [
    ['requirements.txt', parsePythonRequirements],
    ['requirements-dev.txt', parsePythonRequirements],
    ['requirements-prod.txt', parsePythonRequirements],
    ['package.json', parseNodePackageJson],
    ['go.mod', parseGoMod],
    ['Cargo.toml', parseCargoToml],
  ];

  for (const [filename, parser] of parsers) {
    const path = join(cwd, filename);
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, 'utf8');
      packages.push(...parser(content, filename));
    } catch { /* skip unreadable */ }
  }

  // Deduplicate by name+lang
  const seen = new Set<string>();
  const unique = packages.filter((p) => {
    const key = `${p.lang}:${p.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const unpinned = unique.filter((p) => !p.pinned);
  const langs = [...new Set(unique.map((p) => p.lang))];

  return { packages: unique, unpinned, totalCount: unique.length, langs };
}

export function formatSbomReport(report: SbomReport): string {
  const lines: string[] = [`SBOM — ${report.totalCount} packages (${report.langs.join(', ')})`];
  if (report.unpinned.length > 0) {
    lines.push(`\nUnpinned (${report.unpinned.length}):`);
    report.unpinned.slice(0, 20).forEach((p) => lines.push(`  ${p.lang}  ${p.name}  ${p.version}`));
    if (report.unpinned.length > 20) lines.push(`  ... and ${report.unpinned.length - 20} more`);
  }
  lines.push(`\nAll packages:`);
  report.packages.slice(0, 50).forEach((p) => lines.push(`  ${p.pinned ? '✓' : '!'}  ${p.lang}  ${p.name}@${p.version}`));
  return lines.join('\n');
}
