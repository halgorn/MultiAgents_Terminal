export type { AgentManifest } from '../schemas/agent-manifest.js';

export { manifest as scannerManifest } from './scanner.js';
export { manifest as synthesizerManifest } from './synthesizer.js';
export { manifest as plannerManifest } from './planner.js';
export { manifest as investigatorManifest } from './investigator.js';
export { manifest as developerManifest } from './developer.js';
export { manifest as reviewerManifest } from './reviewer.js';
export { manifest as qaManifest } from './qa.js';
export { manifest as explainManifest } from './explain-agent.js';

import { manifest as scannerManifest } from './scanner.js';
import { manifest as synthesizerManifest } from './synthesizer.js';
import { manifest as plannerManifest } from './planner.js';
import { manifest as investigatorManifest } from './investigator.js';
import { manifest as developerManifest } from './developer.js';
import { manifest as reviewerManifest } from './reviewer.js';
import { manifest as qaManifest } from './qa.js';
import { manifest as explainManifest } from './explain-agent.js';
import type { AgentManifest } from '../schemas/agent-manifest.js';

export const AGENT_REGISTRY: AgentManifest[] = [
  scannerManifest,
  synthesizerManifest,
  plannerManifest,
  investigatorManifest,
  developerManifest,
  reviewerManifest,
  qaManifest,
  explainManifest,
];
