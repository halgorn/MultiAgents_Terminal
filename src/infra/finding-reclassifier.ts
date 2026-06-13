import type { AuditFinding } from '../schemas/audit.js';
import type { ProjectIdentity, ProjectType } from './project-identity.js';

type Severity = AuditFinding['severity'];

interface ReclassRule {
  matchText: RegExp;
  types: ProjectType[];
  from: Severity;
  to: Severity;
  note: string;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

// Rules only DOWNGRADE severity — they never upgrade.
// Each rule applies when: project type matches + finding text matches + severity matches.
const RULES: ReclassRule[] = [
  // exec/spawn in CLI and agent frameworks is the expected subprocess model
  {
    matchText: /\bexec\b|execSync|spawnSync|\bspawn\b|child_process/i,
    types: ['cli_tool', 'multi_agent_framework'],
    from: 'critical', to: 'medium',
    note: 'exec/spawn is expected in CLI/agent frameworks for subprocess management',
  },
  {
    matchText: /\bexec\b|execSync|spawnSync|\bspawn\b|child_process/i,
    types: ['cli_tool', 'multi_agent_framework'],
    from: 'high', to: 'low',
    note: 'exec/spawn is expected in CLI/agent frameworks for subprocess management',
  },
  // innerHTML / XSS: no browser context in non-web projects
  {
    matchText: /innerHTML|dangerouslySetInnerHTML|xss|cross.site scripting/i,
    types: ['cli_tool', 'multi_agent_framework', 'library', 'sdk', 'desktop_app'],
    from: 'critical', to: 'info',
    note: 'XSS/innerHTML not applicable outside browser execution context',
  },
  {
    matchText: /innerHTML|dangerouslySetInnerHTML|xss|cross.site scripting/i,
    types: ['cli_tool', 'multi_agent_framework', 'library', 'sdk', 'desktop_app'],
    from: 'high', to: 'info',
    note: 'XSS/innerHTML not applicable outside browser execution context',
  },
  // process.env is the correct Node.js configuration pattern
  {
    matchText: /process\.env/i,
    types: ['cli_tool', 'multi_agent_framework', 'backend_api', 'library', 'sdk'],
    from: 'high', to: 'info',
    note: 'process.env is the standard Node.js secure configuration pattern',
  },
  {
    matchText: /process\.env/i,
    types: ['cli_tool', 'multi_agent_framework', 'backend_api', 'library', 'sdk'],
    from: 'medium', to: 'info',
    note: 'process.env is the standard Node.js secure configuration pattern',
  },
  // SQL injection: only relevant where a database is actually present
  {
    matchText: /sql injection|query\(|raw sql/i,
    types: ['cli_tool', 'multi_agent_framework'],
    from: 'critical', to: 'low',
    note: 'SQL injection rule applied to project without detected database layer',
  },
  // CSRF: only meaningful in stateful browser sessions
  {
    matchText: /csrf|cross.site request forgery/i,
    types: ['cli_tool', 'multi_agent_framework', 'sdk', 'library', 'backend_api'],
    from: 'critical', to: 'low',
    note: 'CSRF not applicable without stateful browser session',
  },
  {
    matchText: /csrf|cross.site request forgery/i,
    types: ['cli_tool', 'multi_agent_framework', 'sdk', 'library', 'backend_api'],
    from: 'high', to: 'info',
    note: 'CSRF not applicable without stateful browser session',
  },
  // AI frameworks require API keys — using process.env is the correct pattern
  {
    matchText: /api.?key|token|api_key|apikey/i,
    types: ['multi_agent_framework'],
    from: 'medium', to: 'info',
    note: 'AI frameworks require API keys via env vars — this is the expected secure pattern',
  },
  {
    matchText: /api.?key|token|api_key|apikey/i,
    types: ['multi_agent_framework'],
    from: 'high', to: 'low',
    note: 'AI frameworks require API keys; confirm no hardcoded values but env var usage is expected',
  },
  // shell:true in CLI is risky but not web-critical
  {
    matchText: /shell.*true|shell:\s*true/i,
    types: ['cli_tool'],
    from: 'critical', to: 'high',
    note: 'shell:true in CLI tool — risky but not critical; ensure input is sanitized',
  },
  // SSRF: irrelevant in local-only execution
  {
    matchText: /ssrf|server.side request forgery/i,
    types: ['cli_tool'],
    from: 'critical', to: 'low',
    note: 'SSRF not applicable in local-only CLI execution',
  },
];

export interface ReclassStats {
  total: number;
  changed: number;
  byTransition: Record<string, number>;
}

export function reclassifyFindings(
  findings: AuditFinding[],
  identity: ProjectIdentity,
): AuditFinding[] {
  return findings.map((f) => {
    const rule = RULES.find(
      (r) =>
        r.types.includes(identity.primary_type) &&
        r.from === f.severity &&
        r.matchText.test(f.finding + ' ' + (f.recommendation ?? '')),
    );
    if (!rule) return f;
    // Safety: never upgrade severity through a downgrade-only rule set
    if (SEVERITY_RANK[rule.to] >= SEVERITY_RANK[rule.from]) return f;
    return {
      ...f,
      severity: rule.to,
      rawSeverity: f.severity,
      contextNote: rule.note,
    } as AuditFinding;
  });
}

export function reclassStats(before: AuditFinding[], after: AuditFinding[]): ReclassStats {
  let changed = 0;
  const byTransition: Record<string, number> = {};
  for (let i = 0; i < before.length; i++) {
    const b = before[i]!;
    const a = after[i]!;
    if (b.severity !== a.severity) {
      changed++;
      const key = `${b.severity}→${a.severity}`;
      byTransition[key] = (byTransition[key] ?? 0) + 1;
    }
  }
  return { total: before.length, changed, byTransition };
}

export function formatReclassNote(stats: ReclassStats): string {
  if (stats.changed === 0) return '';
  const transitions = Object.entries(stats.byTransition)
    .map(([k, n]) => `${n}×${k}`)
    .join(', ');
  return `[context-aware] ${stats.changed}/${stats.total} finding(s) reclassified based on project type: ${transitions}`;
}
