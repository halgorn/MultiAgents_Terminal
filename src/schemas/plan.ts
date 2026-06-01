import { z } from 'zod';

export const PlanPhaseSchema = z.object({
  name: z.string(),
  description: z.string(),
  targetFiles: z.array(z.string()),
  agentType: z.enum(['investigator', 'developer', 'reviewer', 'qa', 'security']),
});

export const PlanReportSchema = z.object({
  taskId: z.string(),
  summary: z.string(),
  phases: z.array(PlanPhaseSchema).min(1),
  riskLevel: z.enum(['low', 'medium', 'high']),
  estimatedFiles: z.array(z.string()),
  constraints: z.array(z.string()),
  relevantModules: z.array(z.string()),
});

export type PlanReport = z.infer<typeof PlanReportSchema>;
