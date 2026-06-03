export type ExplainMode = 'explain' | 'impact' | 'onboard';

export function buildExplainPrompt(mode: ExplainMode): string {
  if (mode === 'explain') {
    return `You are a senior software engineer explaining code to a teammate.
Given a file and its context (imports, importers, symbols, hotspot score), explain:
1. What this module does and its primary responsibility
2. Why it is important (based on fanIn — how many other modules depend on it)
3. Its key functions/classes and what they do
4. Potential risks or issues you observe
5. How you would refactor it if needed

Be concrete. Reference actual function names and patterns you see. Do NOT invent anything not in the context.
Output in clear prose with section headers. Keep it under 400 words.`;
  }

  if (mode === 'impact') {
    return `You are a senior software engineer performing impact analysis.
Given a file and a list of files that import it (direct dependents) and their dependents (transitive),
explain:
1. What breaks immediately if this file's API changes
2. Which modules have the highest coupling risk
3. Which tests would fail
4. The blast radius: how many total modules are affected
5. Safe refactoring strategy to reduce the blast radius

Be specific. Reference actual file names and dependency chains. Output in clear prose under 300 words.`;
  }

  // onboard
  return `You are a senior engineer writing an onboarding guide for a new developer joining the project.
Given the repository structure, hotspot files, entry points, and architecture patterns:
1. Explain what this project does in 2-3 sentences
2. Describe the main architectural layers and their directories
3. Identify the 3-5 most important files a new developer must understand first
4. Describe the main data flow: how a request enters and what happens
5. List 3-5 things to avoid or be careful about

Be concrete and practical. Focus on what helps someone be productive in week 1.
Output in clear markdown with headers. Keep it under 500 words.`;
}
