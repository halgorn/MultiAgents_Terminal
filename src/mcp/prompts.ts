import { readProjectStore } from '../infra/project-store.js';
import { buildDepGraphAuto } from '../infra/dep-graph.js';
import type { PromptDescriptor, PromptResult } from './types.js';

export function buildPromptList(): PromptDescriptor[] {
  return [
    {
      name: 'review_module',
      description: 'Review a module for code quality, performance, and maintainability issues',
      arguments: [
        { name: 'module', description: 'Module file path (e.g. src/auth/middleware.ts)', required: true },
      ],
      handler: reviewModule,
    },
    {
      name: 'explain_cycle',
      description: 'Explain a circular dependency and suggest how to break it',
      arguments: [
        { name: 'cycle', description: 'Comma-separated list of files in the cycle (in order)', required: true },
      ],
      handler: explainCycle,
    },
    {
      name: 'find_security_issue',
      description: 'Hunt for security issues in a module or the whole project',
      arguments: [
        { name: 'scope', description: 'File path or "all" (default: all)', required: false },
      ],
      handler: findSecurityIssue,
    },
    {
      name: 'summarize_recent_changes',
      description: 'Summarize what changed in the last N commits',
      arguments: [
        { name: 'since', description: 'Duration like "7d", "24h" or ISO date (default: 7d)', required: false },
      ],
      handler: summarizeRecentChanges,
    },
    {
      name: 'onboard_new_dev',
      description: 'Onboard a new developer to this project',
      arguments: [],
      handler: onboardNewDev,
    },
    {
      name: 'pre_pr_review',
      description: 'Run a pre-PR review checklist',
      arguments: [
        { name: 'branch', description: 'Branch name (default: current branch)', required: false },
      ],
      handler: prePrReview,
    },
  ];
}

async function reviewModule(args: Record<string, string>): Promise<PromptResult> {
  const module = args['module'] ?? '';
  return {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Please review the module at \`${module}\` and check for:

1. **Code quality**: dead code, unused exports, poor naming, lack of types
2. **Performance**: O(n²) algorithms, unnecessary allocations, blocking I/O
3. **Maintainability**: high cyclomatic complexity, missing tests, undocumented behavior
4. **Architecture**: tight coupling, circular dependencies, missing abstractions

For each issue, cite the line number and explain the impact. Use the tool \`search_memory\` with module-specific queries to find related code, and \`get_dep_graph\` to see what depends on this module.`,
      },
    }],
  };
}

async function explainCycle(args: Record<string, string>): Promise<PromptResult> {
  const cycle = args['cycle'] ?? '';
  return {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `There's a circular dependency: \`${cycle}\`.

Please:
1. Explain the cycle in plain language (what depends on what, and why)
2. Identify the most likely root cause (usually: shared types, mutual utilities, or premature abstraction)
3. Suggest 2-3 concrete refactorings to break the cycle
4. For each refactoring, list which tests would need to be updated

Use the \`aion://docs/architecture\` resource to see the full dep graph, and \`search_memory\` to look at the actual imports in each file.`,
      },
    }],
  };
}

async function findSecurityIssue(args: Record<string, string>): Promise<PromptResult> {
  const scope = args['scope'] ?? 'all';
  return {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Hunt for security issues in: \`${scope}\`.

Focus areas:
- **OWASP Top 10**: injection, broken auth, sensitive data exposure, XXE, broken access control, misconfig, XSS, insecure deserialization, vulnerable components, logging gaps
- **Secrets**: hardcoded API keys, tokens, passwords
- **Input validation**: missing or weak validation
- **Crypto**: weak algorithms, hardcoded keys, missing salting

Use the \`aion://docs/security\` resource to see prior findings, and \`search_memory\` to find relevant code. For each issue found, report: location, severity (critical/high/medium/low), and the recommended fix.`,
      },
    }],
  };
}

async function summarizeRecentChanges(args: Record<string, string>): Promise<PromptResult> {
  const since = args['since'] ?? '7d';
  return {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Summarize what changed in the last \`${since}\` (use git log if available).

Group by:
1. **Features** (new functionality)
2. **Bug fixes**
3. **Refactors** (no behavior change)
4. **Breaking changes** (will need migration)
5. **Hot spots** (files with most churn — may indicate instability)

For each change, mention the files touched. Use the \`aion://docs/recent-changes\` resource to see what the watcher has detected, and consult \`repo-index.json\` for the actual file list.`,
      },
    }],
  };
}

async function onboardNewDev(_args: Record<string, string>): Promise<PromptResult> {
  return {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Onboard me to this project. I just joined the team.

Please:
1. Read \`aion://project/context\` for the high-level overview
2. Read \`aion://docs/architecture\` to understand the module structure
3. Read \`aion://docs/test-coverage\` to see what's tested
4. Identify the 3 most important files/modules to read first
5. Walk me through the typical dev workflow (build, test, deploy)
6. Point me to the most useful tools (\`aion search\`, \`aion chat\`, \`aion watch\`)
7. Flag any TODO/FIXME comments or known issues

Keep the response focused on what I need to know in my first week.`,
      },
    }],
  };
}

async function prePrReview(args: Record<string, string>): Promise<PromptResult> {
  const branch = args['branch'] ?? 'current branch';
  return {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Run a pre-PR review checklist for branch \`${branch}\`.

For each item, report pass/fail/not-applicable:

1. **Tests**: \`aion test\` (or npm test) — all passing?
2. **Lint/typecheck**: any new warnings or errors?
3. **Test coverage**: new code is tested? Run \`aion scan cognitive-load\` to see what changed.
4. **Security**: \`aion scan secrets\` and \`aion scan security\`
5. **Dependencies**: \`aion scan sbom --unpinned-only\` — no new unpinned deps?
6. **Docs**: README, CHANGELOG, inline comments updated?
7. **PIL fresh**: \`aion sync && aion wiki\` — has the project context been updated?
8. **Hotspot impact**: use \`get_impact\` on changed files — did I touch anything critical?
9. **Public API**: any breaking changes that need a major version bump?

Format the output as a checklist. Block the PR if any critical item fails.`,
      },
    }],
  };
}

export { reviewModule, explainCycle, findSecurityIssue, summarizeRecentChanges, onboardNewDev, prePrReview };

void readProjectStore;
void buildDepGraphAuto;
