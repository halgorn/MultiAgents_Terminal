import { spawnSync } from 'child_process';
import type { AuditFinding } from '../schemas/audit.js';

export interface SemgrepResult {
  findings: AuditFinding[];
  filesScanned: number;
  available: boolean;
  error?: string;
}

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

export function runSemgrep(cwd: string): SemgrepResult {
  // Check semgrep is available
  const check = spawnSync('semgrep', ['--version'], { encoding: 'utf8' });
  if (check.status !== 0) {
    return { findings: [], filesScanned: 0, available: false, error: 'semgrep not found' };
  }

  const result = spawnSync(
    'semgrep',
    [
      'scan',
      '--config', 'auto',
      '--json',
      '--no-rewrite-rule-ids',
      '--timeout', '60',
      '--max-memory', '512',
      '.',
    ],
    {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, SEMGREP_SEND_METRICS: 'off' },
    },
  );

  if (!result.stdout) {
    return {
      findings: [],
      filesScanned: 0,
      available: true,
      error: result.stderr?.slice(0, 200) || 'no output',
    };
  }

  let raw: SemgrepRawResult;
  try {
    raw = JSON.parse(result.stdout) as SemgrepRawResult;
  } catch {
    return { findings: [], filesScanned: 0, available: true, error: 'failed to parse semgrep output' };
  }

  const findings: AuditFinding[] = (raw.results ?? []).map((r) => ({
    file: r.path,
    line: r.start.line,
    severity: mapSeverity(r.extra.severity),
    category: mapCategory(r.check_id, r.extra.metadata?.category),
    finding: `[${r.check_id}] ${r.extra.message}`,
    recommendation: `Review ${r.path}:${r.start.line} — fix or suppress with \`# nosemgrep\``,
  }));

  const filesScanned = new Set(findings.map((f) => f.file)).size;
  return { findings, filesScanned, available: true };
}
