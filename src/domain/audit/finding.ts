import { z } from 'zod';

const KNOWN_CATEGORIES = [
  'security', 'architecture', 'performance', 'testing',
  'error-handling', 'types', 'maintainability', 'token-usage',
  'bugs', 'redundancy', 'infrastructure', 'observability',
  'resilience', 'data', 'dependencies', 'compliance', 'multitenancy',
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
  persona: z.string().optional(),      // which scanner domain found this
  rawSeverity: z.string().optional(),  // original severity before contextual reclassification
  contextNote: z.string().optional(),  // reason for reclassification
});

export const ScanReportSchema = z.object({
  filesScanned: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(z.string()),
  ),
  findings: z.array(AuditFindingSchema).default([]),
  summary: z.string(),
});

export const DomainSectionSchema = z.object({
  domain: z.string(),
  findings: z.array(AuditFindingSchema),
  summary: z.string(),
});

export const AuditReportSchema = z.object({
  findings: z.array(AuditFindingSchema),
  criticalCount: z.number().int(),
  highCount: z.number().int(),
  totalFiles: z.number().int(),
  summary: z.string(),
  topPriorities: z.array(z.string()),
  sections: z.array(DomainSectionSchema).optional(),
});

export type AuditFinding = z.infer<typeof AuditFindingSchema>;
export type ScanReport = z.infer<typeof ScanReportSchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;
export type DomainSection = z.infer<typeof DomainSectionSchema>;

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = typeof SEVERITY_ORDER[number];
export type FixSeverity = Exclude<Severity, 'low' | 'info'>;
export const FIX_SEVERITIES = SEVERITY_ORDER.filter((s): s is FixSeverity => s !== 'low' && s !== 'info');

export const SEVERITY_RANK: Record<string, number> = {
  critical: 5, high: 4, medium: 3, low: 2, info: 1,
};
