import { readdirSync, readFileSync } from 'fs';
import { extname, join, relative } from 'path';
import { isGeneratedArtifact, isIgnoredDirName } from './file-filter.js';

export interface NetworkIssue {
  severity: 'high' | 'medium' | 'low';
  area: string;
  issue: string;
  recommendation: string;
}

export interface NetworkReport {
  score: number;
  filesChecked: number;
  httpInsecureSignals: number;
  httpsSignals: number;
  corsWildcard: number;
  corsSignals: number;
  apiKeyExposed: number;
  cookieInsecureSignals: number;
  cookieSecureSignals: number;
  sequentialIdSignals: number;
  mathRandomIdSignals: number;
  sensitiveInUrlSignals: number;
  securityHeaderSignals: number;
  issues: NetworkIssue[];
}

const NET_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rb', '.java', '.yml', '.yaml']);

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
      if (NET_EXTS.has(extname(entry.name)) || entry.name.startsWith('.env')) files.push(rel);
    }
  };
  scan(cwd);
  return files.slice(0, 600);
}

function issue(issues: NetworkIssue[], severity: NetworkIssue['severity'], area: string, text: string, recommendation: string): void {
  issues.push({ severity, area, issue: text, recommendation });
}

export function analyzeNetwork(cwd: string): NetworkReport {
  const files = walk(cwd);
  let httpInsecureSignals = 0;
  let httpsSignals = 0;
  let corsWildcard = 0;
  let corsSignals = 0;
  let apiKeyExposed = 0;
  let cookieInsecureSignals = 0;
  let cookieSecureSignals = 0;
  let sequentialIdSignals = 0;
  let mathRandomIdSignals = 0;
  let sensitiveInUrlSignals = 0;
  let securityHeaderSignals = 0;

  for (const file of files) {
    let content = '';
    try { content = readFileSync(join(cwd, file), 'utf8'); } catch { continue; }

    const httpCount = (content.match(/http:\/\/(?!localhost|127\.|0\.0\.0\.0)/g) ?? []).length;
    const httpsCount = (content.match(/https:\/\//g) ?? []).length;
    httpInsecureSignals += httpCount;
    httpsSignals += httpsCount;

    if (/cors/i.test(content)) {
      corsSignals++;
      if (/origin\s*:\s*['"`]\*['"`]|Access-Control-Allow-Origin['":\s]+\*/.test(content)) corsWildcard++;
    }

    // API keys hardcoded in non-.env files
    if (!/\.env/.test(file)) {
      if (/(sk-[a-zA-Z0-9]{20,}|pk_live_[a-zA-Z0-9]+|AKIA[A-Z0-9]{16}|Bearer\s+['"`][a-zA-Z0-9._\-]{20,}['"`]|apiKey\s*[:=]\s*['"`][a-zA-Z0-9._\-]{10,}['"`])/i.test(content)) {
        apiKeyExposed++;
      }
    }

    if (/res\.cookie\s*\(|setCookie\s*\(/.test(content)) {
      if (/httpOnly\s*:\s*true|secure\s*:\s*true|sameSite/i.test(content)) cookieSecureSignals++;
      else cookieInsecureSignals++;
    }

    if (/\/:id\b.*parseInt|parseInt.*params\.id|Number\s*\(\s*.*params\.id|params\.id\s+as\s+number/i.test(content)) sequentialIdSignals++;

    if (/Math\.random\s*\(\s*\).*id|id.*Math\.random\s*\(\s*\)|Math\.random.*toString\s*\(\s*36\s*\)/i.test(content)) mathRandomIdSignals++;

    if (/\?(?:token|key|password|secret|api_key|apikey|auth)=/i.test(content)) sensitiveInUrlSignals++;

    if (/helmet\s*\(\s*\)|X-Frame-Options|Content-Security-Policy|X-Content-Type-Options|Strict-Transport-Security/i.test(content)) securityHeaderSignals++;
  }

  const issues: NetworkIssue[] = [];

  if (httpInsecureSignals > 0) issue(issues, 'high', 'Transport', `${httpInsecureSignals} insecure http:// URL(s) found (non-localhost)`, 'Replace with https:// and enforce TLS. Never use plain HTTP for external calls.');
  if (corsWildcard > 0) issue(issues, 'high', 'CORS', `${corsWildcard} wildcard CORS origin (*) detected`, "Replace origin: '*' with an explicit allowlist. Never use wildcard with credentials.");
  if (apiKeyExposed > 0) issue(issues, 'high', 'Secrets', `${apiKeyExposed} potential hardcoded API key(s) in source files`, 'Move all keys to environment variables. Rotate any exposed keys immediately.');
  if (mathRandomIdSignals > 0) issue(issues, 'high', 'ID generation', `${mathRandomIdSignals} Math.random() used for ID generation`, 'Use crypto.randomUUID(), nanoid, or ULID for cryptographically secure IDs.');
  if (cookieInsecureSignals > 0) issue(issues, 'medium', 'Cookies', `${cookieInsecureSignals} cookie(s) set without httpOnly/secure/sameSite`, "Add httpOnly: true, secure: true, sameSite: 'strict' to all sensitive cookies.");
  if (sequentialIdSignals > 0) issue(issues, 'medium', 'IDOR', `${sequentialIdSignals} route(s) using sequential integer ID — IDOR risk`, 'Use UUIDs for public-facing IDs and verify resource ownership on every request.');
  if (sensitiveInUrlSignals > 0) issue(issues, 'medium', 'Data exposure', `${sensitiveInUrlSignals} sensitive parameter(s) passed as URL query string`, 'Never pass tokens or credentials as query params — they appear in logs, history, and referrer headers.');
  if (corsSignals === 0) issue(issues, 'low', 'CORS', 'No CORS configuration detected', 'Explicitly configure CORS with an origin allowlist even for same-origin APIs.');
  if (securityHeaderSignals === 0) issue(issues, 'low', 'Headers', 'No HTTP security headers detected (helmet, CSP, HSTS)', 'Add helmet or equivalent middleware. Set CSP, HSTS, X-Frame-Options at minimum.');

  const deduction = issues.reduce((sum, i) => sum + (i.severity === 'high' ? 25 : i.severity === 'medium' ? 12 : 4), 0);
  return {
    score: Math.max(0, 100 - deduction),
    filesChecked: files.length,
    httpInsecureSignals,
    httpsSignals,
    corsWildcard,
    corsSignals,
    apiKeyExposed,
    cookieInsecureSignals,
    cookieSecureSignals,
    sequentialIdSignals,
    mathRandomIdSignals,
    sensitiveInUrlSignals,
    securityHeaderSignals,
    issues,
  };
}
