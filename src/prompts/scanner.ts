export type ScanDomain =
  | 'security'
  | 'error-handling'
  | 'architecture'
  | 'testing'
  | 'performance';

export const SCAN_DOMAINS: ScanDomain[] = [
  'security',
  'error-handling',
  'architecture',
  'testing',
  'performance',
];

const DOMAIN_CONFIG: Record<ScanDomain, { title: string; grepPatterns: string[]; instructions: string }> = {
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

export function buildScannerPrompt(domain: ScanDomain, scannerIndex: number, totalScanners: number): string {
  const cfg = DOMAIN_CONFIG[domain];
  return `# ${cfg.title} (${scannerIndex + 1} of ${totalScanners})

You are a specialized code auditor. Your ONLY job is to find **${domain}** issues.

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
