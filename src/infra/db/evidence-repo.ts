import { saveEvidenceEntry, loadEvidence } from './store.js';
import { EvidenceReportSchema } from '../../schemas/evidence.js';
import type { EvidenceReport } from '../../schemas/evidence.js';
import { log } from '../logger.js';

export function saveEvidence(
  taskId: string,
  agentName: string,
  _domain: string | undefined,
  report: EvidenceReport,
): void {
  saveEvidenceEntry(taskId, agentName, report);
}

export function getEvidenceForTask(taskId: string): EvidenceReport[] {
  const entries = loadEvidence(taskId) as Array<{ report?: unknown }>;
  const reports: EvidenceReport[] = [];
  for (const entry of entries) {
    const parsed = EvidenceReportSchema.safeParse(entry.report);
    if (parsed.success) {
      reports.push(parsed.data);
    } else {
      log.warn(`Evidence entry for task "${taskId}" failed validation, skipping: ${parsed.error.message}`);
    }
  }
  return reports;
}
