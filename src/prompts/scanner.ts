export type ScanDomain =
  | 'security'
  | 'error-handling'
  | 'architecture'
  | 'testing'
  | 'performance'
  | 'bugs'
  | 'redundancy'
  | 'infrastructure'
  | 'observability'
  | 'resilience'
  | 'data'
  | 'dependencies'
  | 'compliance'
  | 'multitenancy';

export const SCAN_DOMAINS: ScanDomain[] = [
  'security',
  'bugs',
  'redundancy',
  'error-handling',
  'architecture',
  'testing',
  'performance',
  'infrastructure',
  'observability',
  'resilience',
  'data',
  'dependencies',
  'compliance',
  'multitenancy',
];

export type { DomainConfig } from './scanner-domains-infra.js';
import type { DomainConfig } from './scanner-domains-infra.js';
import { INFRA_DOMAIN_CONFIG } from './scanner-domains-infra.js';

const DOMAIN_CONFIG: Record<ScanDomain, DomainConfig> = {
  ...INFRA_DOMAIN_CONFIG,
  bugs: {
    title: 'Bug Scanner',
    grepPatterns: [
      'null', 'undefined', 'NaN', 'parseInt(', 'parseFloat(',
      '=== null', '!== null', '== null', '!= null',
      'async ', 'await ', 'Promise.all', 'Promise.race',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'push(', 'pop(', 'shift(', 'splice(',
      'index', 'length', 'slice(', 'substr(',
    ],
    instructions: `Use Grep and Bash to find real logic bugs:
1. Null/undefined dereference: grep for patterns like ".x" after nullable assignments, optional chaining missing
2. Off-by-one errors: array index accesses near .length, slice/substr with boundary values
3. Race conditions: concurrent state mutations, shared mutable state in async flows, unguarded Promise.all
4. Type coercion bugs: == instead of ===, parseInt without radix, NaN comparisons
5. Infinite loops or missing exit conditions: loops with external state, missing break
6. State machine violations: transitions that skip required states, missing guards
For each finding, Read the relevant section (offset/limit) to confirm it's a real bug, not a false positive.`,
  },
  redundancy: {
    title: 'Redundancy Scanner',
    grepPatterns: [
      'function ', 'const ', 'class ', 'export ',
      'import ', 'require(',
      'if (', 'switch (', 'for (', 'while (',
    ],
    instructions: `Use Bash to find redundant and dead code:
1. Duplicate function names across files: grep -rn "^function \\|^const .*= (" --include="*.ts" --include="*.py" . | awk -F'[: ]' '{print $NF}' | sort | uniq -d | head -20
2. Exported symbols never imported elsewhere: grep -rn "^export " --include="*.ts" . | grep -v "index.ts" | head -30 — then cross-check with grep for each symbol name
3. Dead imports: grep -rn "^import " --include="*.ts" . | head -40 — look for modules imported but symbols unused
4. Similar logic blocks: find functions >20 lines with similar names (e.g., getUser/fetchUser/loadUser) — Read both to compare
5. Config/constant duplication: grep -rn "const.*=.*['\"]" --include="*.ts" . | sort -t= -k2 | uniq -d -f1 | head -20
Report only confirmed cases with file+line. Do not speculate.`,
  },
  security: {
    title: 'Security Scanner',
    grepPatterns: [
      'eval(', 'exec(', 'execSync(', 'spawn(',
      'dangerously', 'skip-permissions', 'no-verify',
      'password', 'secret', 'api_key', 'apikey', 'token',
      'process.env', 'SQL', 'query(', 'innerHTML', 'dangerouslySetInnerHTML',
      'child_process', 'shell: true',
    ],
    instructions: `Use Grep to search for each of these patterns across the entire codebase.
For each match, Read only the relevant section (offset/limit) to determine if it's actually a vulnerability.
Focus on: hardcoded credentials, command injection, SQL injection, XSS, unsafe deserialization, overly broad permissions.
Skip false positives (e.g., comments, test fixtures).`,
  },
  'error-handling': {
    title: 'Error Handling Scanner',
    grepPatterns: [
      'catch {', 'catch(_)', 'catch (e) {}', 'catch (err) {}',
      '} catch {', 'catch (error) {}',
      '.then(', 'async function', 'await ',
      'Promise.all', 'Promise.race',
      'setTimeout', 'setInterval',
    ],
    instructions: `Use Grep to find:
1. Empty or swallowed catch blocks: "catch {" with no body, or "catch" blocks that don't log/rethrow
2. Unhandled promise rejections: .then() without .catch()
3. Async functions with no try/catch around awaits
4. Missing error propagation (catching then returning undefined)
Read only the matching sections to confirm issues. Report file+line for each.`,
  },
  architecture: {
    title: 'Architecture Scanner',
    grepPatterns: [
      'import ', 'require(', 'export ', 'export default',
      'class ', 'function ', 'const ', 'TODO', 'FIXME', 'HACK', 'XXX',
    ],
    instructions: `Use Bash to run these checks:
1. Find large files: find . -name "*.ts" -o -name "*.py" -o -name "*.js" | xargs wc -l 2>/dev/null | sort -rn | head -20
2. Find TODO/FIXME/HACK: grep -rn "TODO\\|FIXME\\|HACK\\|XXX" --include="*.ts" --include="*.py" --include="*.js" . | head -30
3. Find duplicate function names: grep -rn "^function \\|^const .* = (" --include="*.ts" . | awk -F: '{print $NF}' | sort | uniq -d | head -20
Then Read the largest/most problematic files (offset/limit, max 100 lines each).
Report: god classes (>300 lines), deep nesting, duplicated logic, technical debt markers.`,
  },
  testing: {
    title: 'Testing Scanner',
    grepPatterns: [
      'test(', 'it(', 'describe(', 'expect(',
      '.test.', '.spec.', '__tests__',
      'export function', 'export class', 'export const',
    ],
    instructions: `Use Bash to check test coverage gaps:
1. List all source files: find src -name "*.ts" ! -name "*.test.ts" ! -name "*.spec.ts" | sort
2. List all test files: find . -name "*.test.*" -o -name "*.spec.*" | sort
3. Cross-reference: which source modules have NO corresponding test file?
4. Grep for untested exports: grep -rn "^export" src/ --include="*.ts" | grep -v test | head -30
Report: modules with zero test coverage, critical paths that are untested, TODO test markers.`,
  },
  performance: {
    title: 'Performance Scanner',
    grepPatterns: [
      'readFileSync', 'writeFileSync', 'execSync', 'spawnSync',
      'for (', 'forEach(', 'map(', 'filter(', 'reduce(',
      'await ', 'setTimeout', 'setInterval',
      'JSON.parse', 'JSON.stringify',
      '.length', 'push(', 'concat(',
    ],
    instructions: `Use Grep to find:
1. Sync I/O in async context: readFileSync/writeFileSync/execSync inside async functions
2. Unbounded loops: for/forEach/map on arrays with no size limit
3. Repeated JSON.parse/stringify of large objects in hot paths
4. Missing pagination or limits on data fetches
5. Memory leaks: event listeners not removed, intervals not cleared
Read only matching sections (offset/limit 30 lines) to confirm. Report file+line+severity.`,
  },
};

function buildContextBlock(ctx: ScannerContext): string {
  const parts: string[] = [];
  if (ctx.repoSummary) parts.push(`## Repository Structure\n${ctx.repoSummary}`);
  if (ctx.depGraph) parts.push(`## Dependency Graph\n${ctx.depGraph}`);
  if (ctx.hotspotFiles && ctx.hotspotFiles.length > 0) {
    parts.push(`## High-Coupling Files (read these first — most likely to contain issues)\n${ctx.hotspotFiles.map((f) => `- ${f}`).join('\n')}`);
  }
  return parts.length > 0 ? '\n' + parts.join('\n\n') + '\n' : '';
}

export interface ScannerContext {
  repoSummary?: string;      // GraphAgent.queryWithContext() output
  depGraph?: string;         // formatted dep-graph: cycles, hotspots
  hotspotFiles?: string[];   // top files by coupling score — read these first
}

export function buildScannerPrompt(domain: ScanDomain, scannerIndex: number, totalScanners: number, ctx?: ScannerContext): string {
  const cfg = DOMAIN_CONFIG[domain];
  const contextBlock = ctx ? buildContextBlock(ctx) : '';
  return `# ${cfg.title} (${scannerIndex + 1} of ${totalScanners})

You are a specialized code auditor. Your ONLY job is to find **${domain}** issues.
${contextBlock}
## Allowed Tools
- Grep — search for patterns across the codebase
- Bash — run analysis commands (read-only: find, wc, grep, awk, sort)
- Read — read specific sections of files (max 500 lines at a time using offset/limit)
- NO Write, Edit, or network tools

## Strategy
${cfg.instructions}

## Key patterns to search for
${cfg.grepPatterns.map((p) => `- \`${p}\``).join('\n')}

## Important
- Do NOT read entire files — use offset/limit to read only relevant sections
- Do NOT report false positives — confirm each finding before including it
- If a pattern match is benign (e.g., in a comment or test), skip it
- Focus on REAL issues with concrete file+line evidence
- Return at most 15 findings. Prioritize critical/high severity and summarize repeated instances into one finding.
- Keep each finding and recommendation concise, ideally under 280 characters each.

## Output
Your final response must be ONLY a valid JSON object — no prose, no markdown fences:
{
  "filesScanned": string[],
  "findings": [
    {
      "file": string,
      "line": number | null,
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "category": "${domain}",
      "finding": string,
      "recommendation": string
    }
  ],
  "summary": string
}`;
}
