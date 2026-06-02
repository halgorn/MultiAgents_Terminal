import type { AuditFinding } from '../schemas/audit.js';
import type { RepoIndex } from './repo-index.js';

export interface EvidenceGateResult {
  accepted: AuditFinding[];
  rejected: Array<{ finding: AuditFinding; reason: string }>;
}

export function validateAuditFindings(findings: AuditFinding[], index: RepoIndex | null): EvidenceGateResult {
  if (!index) return { accepted: findings, rejected: [] };

  const files = new Map(index.files.map((file) => [file.path, file]));
  const accepted: AuditFinding[] = [];
  const rejected: Array<{ finding: AuditFinding; reason: string }> = [];

  for (const finding of findings) {
    const file = files.get(finding.file);
    if (!file) {
      rejected.push({ finding, reason: 'file not found in repository index' });
      continue;
    }
    if (finding.line && finding.line > file.loc) {
      rejected.push({ finding, reason: `line ${finding.line} exceeds file length ${file.loc}` });
      continue;
    }
    accepted.push(finding);
  }

  return { accepted, rejected };
}
