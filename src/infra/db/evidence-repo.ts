import { saveEvidenceEntry, loadEvidence } from './store.js';
import type { EvidenceReport } from '../../schemas/evidence.js';

export function saveEvidence(
  taskId: string,
  agentName: string,
  _domain: string | undefined,
  report: EvidenceReport,
): void {
  saveEvidenceEntry(taskId, agentName, report);
}

export function getEvidenceForTask(taskId: string): EvidenceReport[] {
  return (loadEvidence(taskId) as Array<{ report: EvidenceReport }>).map((e) => e.report);
}
