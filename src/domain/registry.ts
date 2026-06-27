import { z } from 'zod';
import { ScanReportSchema, AuditReportSchema } from './audit/finding.js';
import { PatchReportSchema } from './audit/patch.js';
import { ReviewReportSchema } from './audit/review.js';
import { EvidenceReportSchema } from './audit/evidence.js';
import { QAResultSchema } from './audit/qa.js';
import { PlanReportSchema } from './audit/plan.js';

export const ZOD_SCHEMA_REGISTRY: Record<string, z.ZodSchema> = {
  ScanReportSchema,
  AuditReportSchema,
  PatchReportSchema,
  ReviewReportSchema,
  EvidenceReportSchema,
  QAResultSchema,
  PlanReportSchema,
};

export const KNOWN_OUTPUT_SCHEMAS = new Set([
  ...Object.keys(ZOD_SCHEMA_REGISTRY),
  'AuditReport',
  'AuditFixReport',
  'SynthOutputSchema',
  'TaskResult',
  'string',
]);
