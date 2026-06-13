export type { FlowManifest } from '../../schemas/flow-manifest.js';

export { manifest as auditManifest } from './audit-pipeline.js';
export { manifest as fixManifest } from './fix-pipeline.js';
export { manifest as analyzeManifest } from './analyze-pipeline.js';
export { manifest as reviewManifest } from './review-pipeline.js';
export { manifest as auditFixManifest } from './audit-fix-pipeline.js';

import { manifest as auditManifest } from './audit-pipeline.js';
import { manifest as fixManifest } from './fix-pipeline.js';
import { manifest as analyzeManifest } from './analyze-pipeline.js';
import { manifest as reviewManifest } from './review-pipeline.js';
import { manifest as auditFixManifest } from './audit-fix-pipeline.js';
import type { FlowManifest } from '../../schemas/flow-manifest.js';

export const FLOW_REGISTRY: FlowManifest[] = [
  auditManifest,
  fixManifest,
  analyzeManifest,
  reviewManifest,
  auditFixManifest,
];
