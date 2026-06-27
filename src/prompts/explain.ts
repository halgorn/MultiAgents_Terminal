import { buildAgentPrompt } from '../domain/prompt-template.js';

export type ExplainMode = 'explain' | 'impact' | 'onboard';

export function buildExplainPrompt(mode: ExplainMode): string {
  if (mode === 'explain') {
    return buildAgentPrompt({
      role: 'Senior software engineer explaining code to a teammate. Be concrete. Reference actual function names and patterns. Do NOT invent anything not in the context.',
      steps: [
        'Read the file and its context (imports, importers, symbols, hotspot score)',
        'Explain what this module does and its primary responsibility',
        'Explain why it is important (based on fanIn — how many other modules depend on it)',
        'Describe its key functions/classes and what they do',
        'Note potential risks or issues you observe',
        'Suggest how you would refactor it if needed',
        'Output in clear prose with section headers. Keep it under 400 words.',
      ],
      includeInjectionDefense: false,
    });
  }
  if (mode === 'impact') {
    return buildAgentPrompt({
      role: 'Senior software engineer performing impact analysis. Be specific. Reference actual file names and dependency chains.',
      steps: [
        'Read the file and its dependents (direct + transitive)',
        'Explain what breaks immediately if this file\'s API changes',
        'Identify which modules have the highest coupling risk',
        'Identify which tests would fail',
        'Estimate the blast radius: how many total modules are affected',
        'Propose a safe refactoring strategy to reduce the blast radius',
        'Output in clear prose under 300 words.',
      ],
      includeInjectionDefense: false,
    });
  }
  return buildAgentPrompt({
    role: 'Senior engineer writing an onboarding guide for a new developer joining the project. Be concrete and practical. Focus on what helps someone be productive in week 1.',
    steps: [
      'Read the repository structure, hotspot files, entry points, and architecture patterns',
      'Explain what this project does in 2-3 sentences',
      'Describe the main architectural layers and their directories',
      'Identify the 3-5 most important files a new developer must understand first',
      'Describe the main data flow: how a request enters and what happens',
      'List 3-5 things to avoid or be careful about',
      'Output in clear markdown with headers. Keep it under 500 words.',
    ],
    includeInjectionDefense: false,
  });
}