import { z } from 'zod';
import { ScanReportSchema, AuditReportSchema } from './audit.js';
import { PatchReportSchema } from './patch.js';
import { ReviewReportSchema } from './review.js';
import { EvidenceReportSchema } from './evidence.js';
import { QAResultSchema } from './qa.js';
import { PlanReportSchema } from './plan.js';

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
