import { z } from 'zod';

const KNOWN_CATEGORIES = [
  'security', 'architecture', 'performance', 'testing',
  'error-handling', 'types', 'maintainability', 'token-usage',
] as const;

export const AuditFindingSchema = z.object({
  file: z.string(),
  line: z.preprocess(
    (value) => (typeof value === 'number' && value <= 0 ? null : value),
    z.number().int().positive().nullish(),
  ),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  // Accept any category string — normalize unknowns to 'maintainability'
  category: z.string().transform((v) =>
    (KNOWN_CATEGORIES as readonly string[]).includes(v) ? v : 'maintainability',
  ),
  finding: z.string(),
  recommendation: z.string().default('Review the finding and add a focused remediation.'),
});

export const ScanReportSchema = z.object({
  filesScanned: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(z.string()),
  ),
  findings: z.array(AuditFindingSchema).default([]),
  summary: z.string(),
});

export const AuditReportSchema = z.object({
  findings: z.array(AuditFindingSchema),
  criticalCount: z.number().int(),
  highCount: z.number().int(),
  totalFiles: z.number().int(),
  summary: z.string(),
  topPriorities: z.array(z.string()),
});

export type AuditFinding = z.infer<typeof AuditFindingSchema>;
export type ScanReport = z.infer<typeof ScanReportSchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;
