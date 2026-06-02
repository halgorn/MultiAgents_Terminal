import { spawnSync } from 'child_process';
import type { AuditFinding } from '../schemas/audit.js';

export interface SemgrepResult {
  findings: AuditFinding[];
  filesScanned: number;
  available: boolean;
  error?: string;
}

const SEMGREP_MAX_BUFFER = 50 * 1024 * 1024;

interface SemgrepRawResult {
  results?: Array<{
    check_id: string;
    path: string;
    start: { line: number };
    extra: {
      message: string;
      severity: string;
      metadata?: { category?: string };
    };
  }>;
  errors?: Array<{ message: string }>;
  paths?: { scanned?: string[] };
}

function mapSeverity(raw: string): AuditFinding['severity'] {
  switch (raw.toUpperCase()) {
    case 'ERROR':   return 'critical';
    case 'WARNING': return 'high';
    case 'INFO':    return 'medium';
    default:        return 'low';
  }
}

function mapCategory(checkId: string, meta?: string): AuditFinding['category'] {
  const id = (checkId + ' ' + (meta ?? '')).toLowerCase();
  if (/security|injection|xss|sqli|secret|credential|auth|crypto/.test(id)) return 'security';
  if (/perf|performance|memory|cpu|loop/.test(id)) return 'performance';
  if (/test|coverage/.test(id)) return 'testing';
  if (/error|exception|catch|throw/.test(id)) return 'error-handling';
  if (/type|null|undefined/.test(id)) return 'types';
  if (/arch|coupling|depend|import/.test(id)) return 'architecture';
  return 'maintainability';
}

function extractJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) return text.slice(start, i + 1);
    }
  }

  return null;
}

function compact(text: string, max = 320): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

export function parseSemgrepOutput(stdout: string): SemgrepResult {
  let raw: SemgrepRawResult;
  try {
    raw = JSON.parse(extractJsonObject(stdout) ?? stdout) as SemgrepRawResult;
  } catch {
    return { findings: [], filesScanned: 0, available: true, error: 'failed to parse semgrep output' };
  }

  const findings: AuditFinding[] = (raw.results ?? []).map((r) => ({
    file: r.path,
    line: r.start.line,
    severity: mapSeverity(r.extra.severity),
    category: mapCategory(r.check_id, r.extra.metadata?.category),
    finding: compact(`[${r.check_id}] ${r.extra.message}`),
    recommendation: `Review ${r.path}:${r.start.line} — fix or suppress with \`# nosemgrep\``,
  }));

  const scanned = raw.paths?.scanned?.length ?? new Set(findings.map((f) => f.file)).size;
  return { findings, filesScanned: scanned, available: true };
}

export function runSemgrep(cwd: string): SemgrepResult {
  // Check semgrep is available
  const check = spawnSync('semgrep', ['--version'], { encoding: 'utf8', maxBuffer: SEMGREP_MAX_BUFFER });
  if (check.status !== 0) {
    const error = check.stderr?.slice(0, 200) || check.error?.message || 'semgrep not found';
    return { findings: [], filesScanned: 0, available: false, error };
  }

  const result = spawnSync(
    'semgrep',
    [
      'scan',
      '--config', 'auto',
      '--json',
      '--quiet',
      '--no-rewrite-rule-ids',
      '--timeout', '60',
      '--max-memory', '512',
      '.',
    ],
    {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: SEMGREP_MAX_BUFFER,
      env: process.env,
    },
  );

  if (result.error) {
    return { findings: [], filesScanned: 0, available: true, error: result.error.message };
  }

  if (!result.stdout) {
    return {
      findings: [],
      filesScanned: 0,
      available: true,
      error: result.stderr?.slice(0, 200) || 'no output',
    };
  }

  return parseSemgrepOutput(result.stdout);
}
