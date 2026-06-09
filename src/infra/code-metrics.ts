import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { spawnSync } from 'child_process';
import { SOURCE_EXTS as SRC_EXTS, isGeneratedArtifact, isIgnoredDirName } from '../cli/cli-utils.js';

// ── Hot Zone Ranking ──────────────────────────────────────────────────────────

export interface RankedFile {
  file: string;
  score: number;
  reasons: string[];
}

export function rankFilesByRisk(
  files: string[],
  options: {
    churnCounts?: Map<string, number>;
    depFanIn?: Map<string, number>;
    semgrepFiles?: Set<string>;
    cognitiveScores?: Map<string, number>;
  } = {},
): RankedFile[] {
  const { churnCounts, depFanIn, semgrepFiles, cognitiveScores } = options;

  return files.map((file) => {
    let score = 0;
    const reasons: string[] = [];
    const base = file.split('/').pop() ?? '';
    const depth = file.split('/').length;

    score += Math.max(0, 6 - depth) * 3;

    if (/^(index|main|app|server|router|handler|controller|service|middleware|auth|api)\.[a-z]+$/.test(base)) {
      score += 10; reasons.push('key-module');
    }

    if (churnCounts) {
      const c = churnCounts.get(file) ?? 0;
      if (c > 10) { score += 15; reasons.push(`churn:${c}`); }
      else if (c > 5) { score += 8; reasons.push(`churn:${c}`); }
      else if (c > 2) { score += 4; reasons.push(`churn:${c}`); }
    }

    if (depFanIn) {
      const f = depFanIn.get(file) ?? 0;
      if (f > 10) { score += 15; reasons.push(`dep-central:${f}`); }
      else if (f > 5) { score += 8; reasons.push(`dep-central:${f}`); }
      else if (f > 2) { score += 4; reasons.push(`dep-central:${f}`); }
    }

    if (semgrepFiles?.has(file)) { score += 12; reasons.push('semgrep-hit'); }

    if (cognitiveScores) {
      const cx = cognitiveScores.get(file) ?? 0;
      if (cx > 30) { score += 10; reasons.push(`complexity:${cx}`); }
      else if (cx > 15) { score += 5; reasons.push(`complexity:${cx}`); }
    }

    if (/\.(test|spec)\.[a-z]+$/.test(file)) score -= 5;

    return { file, score, reasons };
  }).sort((a, b) => b.score - a.score);
}

export interface ApiEndpoint {
  method: string;
  path: string;
  file: string;
  line: number;
  hasAuth: boolean;
  hasRateLimit: boolean;
}

export interface EnvVar {
  name: string;
  file: string;
  line: number;
  documented: boolean;
}

export interface EnvAuditResult {
  vars: EnvVar[];
  undocumented: string[];
  envExampleExists: boolean;
}

export interface CognitiveEntry {
  file: string;
  score: number;
  maxNesting: number;
  longFunctions: number;
  magicNumbers: number;
  avgLineLength: number;
  loc: number;
}

export interface SecretHit {
  file: string;
  line: number;
  pattern: string;
  preview: string;
}

const SOURCE_EXTS = new Set(SRC_EXTS);

function walk(dir: string, exts?: Set<string>): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isIgnoredDirName(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { files.push(...walk(full, exts)); continue; }
      if (isGeneratedArtifact(full)) continue;
      if (!exts || exts.has(extname(entry.name))) files.push(full);
    }
  } catch { /* skip unreadable */ }
  return files;
}

function grep(cwd: string, pattern: string, args: string[] = []): string {
  const result = spawnSync('grep', ['-rn', pattern, ...args, '.'], {
    cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 5 * 1024 * 1024,
  });
  return result.stdout ?? '';
}

// ── API Map ───────────────────────────────────────────────────────────────────

const ROUTE_PATTERNS: Array<{ re: RegExp; method: string }> = [
  { re: /@(?:app|router)\.(get|post|put|delete|patch|head|options)\(['"]([^'"]+)['"]/, method: '' },
  { re: /router\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/, method: '' },
  { re: /app\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/, method: '' },
  { re: /@app\.route\(['"]([^'"]+)['"].*methods=\[['"]([A-Z]+)['"]/, method: '' },
  { re: /Route\(['"]([^'"]+)['"].*methods=\[['"]([A-Z]+)['"]/, method: '' },
];

export function buildApiMap(cwd: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const files = walk(cwd, SOURCE_EXTS).map((f) => relative(cwd, f));

  for (const relPath of files.filter((f) => /route|api|controller|view|handler/i.test(f))) {
    let content: string;
    try { content = readFileSync(join(cwd, relPath), 'utf8'); } catch { continue; }
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      for (const { re } of ROUTE_PATTERNS) {
        const m = re.exec(line);
        if (!m) continue;

        // Determine method and path from capture groups
        let method = '', path = '';
        if (m[1] && m[2]) {
          // @router.get('/path') or route with methods
          method = /^(get|post|put|delete|patch|head|options)$/i.test(m[1]) ? m[1].toUpperCase() : m[2].toUpperCase();
          path = /^(get|post|put|delete|patch|head|options)$/i.test(m[1]) ? m[2] : m[1];
        } else if (m[1]) {
          method = 'ANY';
          path = m[1];
        }

        if (!path) continue;

        // Check surrounding lines for auth/rate-limit
        const context = lines.slice(Math.max(0, idx - 5), idx + 2).join('\n');
        const hasAuth = /auth|login_required|require_auth|token|jwt|bearer|security|permission/i.test(context);
        const hasRateLimit = /rate_?limit|throttle|ratelimit/i.test(context);

        endpoints.push({ method, path, file: relPath, line: idx + 1, hasAuth, hasRateLimit });
        break;
      }
    });
  }

  return endpoints.sort((a, b) => a.file.localeCompare(b.file));
}

// ── Env Audit ─────────────────────────────────────────────────────────────────

const ENV_RE = /(?:os\.environ(?:\.get)?\[?['"]|process\.env\[?['"]|getenv\(['"]|os\.getenv\(['"']|ENV\[['"])([A-Z][A-Z0-9_]+)/g;

export function auditEnvVars(cwd: string): EnvAuditResult {
  const varMap = new Map<string, { file: string; line: number }>();
  const files = walk(cwd, SOURCE_EXTS).map((f) => relative(cwd, f));

  for (const relPath of files) {
    let content: string;
    try { content = readFileSync(join(cwd, relPath), 'utf8'); } catch { continue; }
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      let m: RegExpExecArray | null;
      const re = new RegExp(ENV_RE.source, 'g');
      while ((m = re.exec(line)) !== null) {
        const name = m[1]!;
        if (!varMap.has(name)) varMap.set(name, { file: relPath, line: idx + 1 });
      }
    });
  }

  // Check if documented in .env.example, README, or .env
  const docSources = ['.env.example', '.env.sample', '.env.template', 'README.md', 'README.rst', '.env'];
  let docContent = '';
  for (const src of docSources) {
    try { docContent += readFileSync(join(cwd, src), 'utf8') + '\n'; } catch { /* ok */ }
  }

  const envExampleExists = docSources.slice(0, 3).some((s) => { try { statSync(join(cwd, s)); return true; } catch { return false; } });
  const vars: EnvVar[] = [...varMap.entries()].map(([name, loc]) => ({
    name, file: loc.file, line: loc.line, documented: docContent.includes(name),
  }));
  const undocumented = vars.filter((v) => !v.documented).map((v) => v.name);

  return { vars, undocumented, envExampleExists };
}

// ── Cognitive Load ────────────────────────────────────────────────────────────

function measureFile(content: string): Omit<CognitiveEntry, 'file' | 'score'> {
  const lines = content.split('\n');
  let maxNesting = 0;
  let magicNumbers = 0;
  let longFunctions = 0;
  let totalLen = 0;
  let funcStart = -1;
  let funcLines = 0;

  for (const line of lines) {
    totalLen += line.length;
    // Nesting: count leading spaces / 2 or tabs
    const stripped = line.trimStart();
    const indent = line.length - stripped.length;
    const nesting = Math.floor(indent / 2);
    if (nesting > maxNesting) maxNesting = nesting;

    // Magic numbers: numeric literals not 0, 1, -1, 2, common powers
    const nums = stripped.match(/\b\d{2,}\b/g) ?? [];
    magicNumbers += nums.filter((n) => !['10', '100', '1000', '200', '404', '500', '256', '1024'].includes(n)).length;

    // Long functions (>60 lines)
    if (/^\s*(?:def |function |async def |async function |const \w+ = (?:async )?\()/.test(line)) {
      if (funcStart !== -1 && funcLines > 60) longFunctions++;
      funcStart = 0;
      funcLines = 0;
    }
    if (funcStart !== -1) funcLines++;
  }
  if (funcStart !== -1 && funcLines > 60) longFunctions++;

  return {
    maxNesting,
    longFunctions,
    magicNumbers: Math.min(magicNumbers, 50),
    avgLineLength: lines.length > 0 ? Math.round(totalLen / lines.length) : 0,
    loc: lines.length,
  };
}

export function measureCognitiveLoad(cwd: string, limit = 30): CognitiveEntry[] {
  const files = walk(cwd, SOURCE_EXTS).slice(0, 300);
  const results: CognitiveEntry[] = [];

  for (const full of files) {
    let content: string;
    try { content = readFileSync(full, 'utf8'); } catch { continue; }
    const metrics = measureFile(content);
    const score = metrics.maxNesting * 3 + metrics.longFunctions * 5 + Math.floor(metrics.magicNumbers / 3) + Math.max(0, metrics.avgLineLength - 80) / 5;
    results.push({ file: relative(cwd, full), score: Math.round(score), ...metrics });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function buildCognitiveScores(cwd: string, files: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const relFile of files) {
    const full = join(cwd, relFile);
    let content: string;
    try { content = readFileSync(full, 'utf8'); } catch { continue; }
    const m = measureFile(content);
    const score = m.maxNesting * 3 + m.longFunctions * 5 + Math.floor(m.magicNumbers / 3) + Math.max(0, m.avgLineLength - 80) / 5;
    scores.set(relFile, Math.round(score));
  }
  return scores;
}

// ── Secrets Scan (current files only) ────────────────────────────────────────

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'hardcoded-password', re: /(?:password|passwd|pwd)\s*=\s*['"][^'"]{6,}['"]/ },
  { name: 'hardcoded-api-key', re: /(?:api[_-]?key|apikey)\s*=\s*['"][^'"]{8,}['"]/ },
  { name: 'hardcoded-secret', re: /(?:secret[_-]?key?)\s*=\s*['"][^'"]{8,}['"]/ },
  { name: 'openai-key', re: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'github-token', re: /ghp_[a-zA-Z0-9]{36}/ },
  { name: 'private-key', re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: 'aws-key', re: /AKIA[0-9A-Z]{16}/ },
];

export function scanCurrentSecrets(cwd: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const files = walk(cwd, SOURCE_EXTS).slice(0, 500);

  for (const full of files) {
    let content: string;
    try { content = readFileSync(full, 'utf8'); } catch { continue; }
    const relPath = relative(cwd, full);

    content.split('\n').forEach((line, idx) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('#')) return;
      for (const { name, re } of SECRET_PATTERNS) {
        if (re.test(line)) {
          hits.push({ file: relPath, line: idx + 1, pattern: name, preview: line.trim().slice(0, 80) });
          break;
        }
      }
    });

    if (hits.length >= 50) break;
  }

  return hits;
}
