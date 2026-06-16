import { readdirSync, readFileSync } from 'fs';
import { extname, join, relative } from 'path';
import { isGeneratedArtifact, isIgnoredDirName } from './file-filter.js';

export interface SecurityScanIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  area: string;
  issue: string;
  recommendation: string;
}

export interface SecurityScanReport {
  score: number;
  filesChecked: number;
  xssSignals: number;
  jwtWeakSignals: number;
  protoPollutionSignals: number;
  massAssignmentSignals: number;
  pathTraversalSignals: number;
  errorLeakageSignals: number;
  evalSignals: number;
  issues: SecurityScanIssue[];
}

const SEC_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rb', '.java', '.vue', '.svelte']);

function walk(cwd: string): string[] {
  const files: string[] = [];
  const scan = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (isIgnoredDirName(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relative(cwd, full);
      if (entry.isDirectory()) { scan(full); continue; }
      if (isGeneratedArtifact(rel)) continue;
      if (SEC_EXTS.has(extname(entry.name))) files.push(rel);
    }
  };
  scan(cwd);
  return files.slice(0, 600);
}

function issue(issues: SecurityScanIssue[], severity: SecurityScanIssue['severity'], area: string, text: string, recommendation: string): void {
  issues.push({ severity, area, issue: text, recommendation });
}

export function runSecurityScan(cwd: string): SecurityScanReport {
  const files = walk(cwd);
  let xssSignals = 0;
  let jwtWeakSignals = 0;
  let protoPollutionSignals = 0;
  let massAssignmentSignals = 0;
  let pathTraversalSignals = 0;
  let errorLeakageSignals = 0;
  let evalSignals = 0;

  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }

    // Regex patterns below detect dangerous constructs IN USER CODE (not used here)
    // XSS
    const xssPattern = /innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(|v-html\s*=|\.html\s*\(\s*(?:user|input|data|req\.|res\.|body|param)/i;
    if (xssPattern.test(content)) xssSignals++;

    // eval / dynamic code execution — matched as strings in target files, not called here
    const evalPattern = /\beval\s*\(|\bnew\s+Function\s*\(|vm\.runInContext\s*\(|vm\.runInNewContext\s*\(/i;
    if (evalPattern.test(content)) evalSignals++;

    // JWT weakness
    if (/(?:alg|algorithm)\s*[=:]\s*['"]none['"]|jwt\.sign[^;]{0,120}(?:['"]secret['"]|['"]password['"]|['"]123456['"]|['"]changeme['"])|jwt\.verify[^;]{0,80}(?:algorithms\s*:\s*\[\s*['"]none)/i.test(content)) jwtWeakSignals++;
    if (/jwt\.sign\s*\([^)]{0,200}\)(?![^;]{0,100}expiresIn)/i.test(content)) jwtWeakSignals++;

    // Prototype pollution
    if (/Object\.assign\s*\(\s*\w+\s*,\s*req\.body\)|(?:_|lodash)\.merge\s*\(\s*\w+\s*,\s*req\.body\)|Object\.assign\s*\(\s*(?:this|obj|target|options)\s*,\s*(?:body|params|query)\)/i.test(content)) protoPollutionSignals++;

    // Mass assignment
    if (/\.create\s*\(\s*\{\s*\.\.\.\s*req\.body|\.update\s*\([^)]*\{\s*\.\.\.\s*req\.body|\.insertMany\s*\(\s*req\.body|\.save\s*\(\s*req\.body|new\s+\w+\s*\(\s*req\.body/i.test(content)) massAssignmentSignals++;

    // Path traversal
    if (/(?:readFileSync|readFile|createReadStream|sendFile|download)\s*\([^)]*(?:req\.params|req\.query|req\.body|params\.\w+|query\.\w+)/i.test(content)) pathTraversalSignals++;
    if (/path\.join\s*\([^)]*(?:req\.params|req\.query|req\.body)/i.test(content)) pathTraversalSignals++;

    // Error leakage
    if (/res\.(?:json|send)\s*\(\s*(?:err|error)\s*\)|res\.(?:json|send)\s*\([^)]*(?:err|error)\.(?:stack|message)\)|res\.(?:json|send)\s*\(\s*\{[^}]{0,100}stack/i.test(content)) errorLeakageSignals++;
  }

  const issues: SecurityScanIssue[] = [];

  if (evalSignals > 0) issue(issues, 'critical', 'Code injection', `${evalSignals} eval()/new Function() / vm.run usage(s) detected`, 'Never use eval or new Function with dynamic input. Use safe alternatives or structured data parsers.');
  if (jwtWeakSignals > 0) issue(issues, 'critical', 'JWT', `${jwtWeakSignals} JWT weakness signal(s): alg:none, trivial secret, or missing expiry`, "Use RS256/ES256, set expiresIn, and never use 'none' algorithm or trivial secrets.");
  if (protoPollutionSignals > 0) issue(issues, 'high', 'Prototype pollution', `${protoPollutionSignals} Object.assign/merge with req.body detected`, 'Never merge unvalidated user input into plain objects. Validate and whitelist fields first.');
  if (massAssignmentSignals > 0) issue(issues, 'high', 'Mass assignment', `${massAssignmentSignals} DB create/update spread from req.body`, 'Always whitelist accepted fields. Never pass req.body directly to ORM create/update calls.');
  if (xssSignals > 0) issue(issues, 'high', 'XSS', `${xssSignals} potential XSS sink(s): innerHTML / dangerouslySetInnerHTML / document.write`, 'Use textContent instead of innerHTML. Sanitize with DOMPurify before any HTML rendering.');
  if (pathTraversalSignals > 0) issue(issues, 'high', 'Path traversal', `${pathTraversalSignals} file operation(s) with user-controlled path`, 'Resolve and normalize paths. Validate they stay within expected base directory using path.resolve().');
  if (errorLeakageSignals > 0) issue(issues, 'medium', 'Error leakage', `${errorLeakageSignals} potential stack trace / error object sent to client`, 'Never send err or err.stack to the client. Return a generic error message and log internally.');

  const deduction = issues.reduce((sum, i) => sum + (i.severity === 'critical' ? 35 : i.severity === 'high' ? 20 : i.severity === 'medium' ? 10 : 4), 0);
  return {
    score: Math.max(0, 100 - deduction),
    filesChecked: files.length,
    xssSignals,
    jwtWeakSignals,
    protoPollutionSignals,
    massAssignmentSignals,
    pathTraversalSignals,
    errorLeakageSignals,
    evalSignals,
    issues,
  };
}
