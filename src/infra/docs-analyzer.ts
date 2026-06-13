import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { SOURCE_EXTS, isGeneratedArtifact, isIgnoredDirName } from './file-filter.js';

export interface DocGap {
  type: 'missing-file' | 'missing-section' | 'undocumented-export' | 'missing-docstring';
  severity: 'high' | 'medium' | 'low';
  file?: string;
  description: string;
  suggestion: string;
}

export interface DocsReport {
  gaps: DocGap[];
  score: number; // 0-100
  existingDocs: string[];
  summary: string;
}

// ── Required files ────────────────────────────────────────────────────────────

const REQUIRED_FILES = [
  { file: 'README.md',      severity: 'high'   as const, suggestion: 'Create README.md with install, usage, and configuration sections' },
  { file: 'CHANGELOG.md',   severity: 'low'    as const, suggestion: 'Create CHANGELOG.md to track version history' },
  { file: 'CONTRIBUTING.md',severity: 'low'    as const, suggestion: 'Create CONTRIBUTING.md with development setup and PR guidelines' },
  { file: '.env.example',   severity: 'medium' as const, suggestion: 'Create .env.example listing all required environment variables' },
];

const README_SECTIONS = [
  { pattern: /#+\s*(install|installation|getting.?started)/i, label: 'Installation', severity: 'high' as const },
  { pattern: /#+\s*(usage|quick.?start|example)/i,           label: 'Usage',         severity: 'high' as const },
  { pattern: /#+\s*(config|configuration|environment|env)/i, label: 'Configuration', severity: 'medium' as const },
  { pattern: /#+\s*(api|endpoints|routes)/i,                 label: 'API reference', severity: 'low'  as const },
  { pattern: /#+\s*(contribut|development|dev.?setup)/i,     label: 'Contributing',  severity: 'low'  as const },
];

// ── JSDoc / docstring detection ───────────────────────────────────────────────

function hasDocstring(content: string, exportLine: number, lines: string[]): boolean {
  // Check the line above for JSDoc /** or Python docstring """
  const above = lines[exportLine - 2] ?? '';
  const twoAbove = lines[exportLine - 3] ?? '';
  return above.trim().startsWith('*') ||
         above.trim().startsWith('*/') ||
         twoAbove.trim().startsWith('/**') ||
         above.trim().startsWith('"""') ||
         above.trim().startsWith("'''");
}

const EXPORT_RE = /^export\s+(function|class|const|interface|type|enum|async function)\s+([A-Za-z_]\w*)/;
const PY_DEF_RE = /^(?:def|class|async def)\s+([A-Za-z_]\w*)/;

function findUndocumentedExports(cwd: string, file: string): DocGap[] {
  const gaps: DocGap[] = [];
  let content: string;
  try { content = readFileSync(join(cwd, file), 'utf8'); } catch { return []; }
  const lines = content.split('\n');
  const ext = extname(file);
  const isPy = ext === '.py';

  lines.forEach((line, i) => {
    const m = isPy ? PY_DEF_RE.exec(line.trim()) : EXPORT_RE.exec(line);
    if (!m) return;
    const name = isPy ? m[1] : m[2];
    if (!name || name.startsWith('_')) return; // skip private

    if (!hasDocstring(content, i, lines)) {
      gaps.push({
        type: 'missing-docstring',
        severity: 'low',
        file,
        description: `${isPy ? 'def' : 'export'} \`${name}\` has no docstring`,
        suggestion: `Add JSDoc/docstring above \`${name}\` in ${file}`,
      });
    }
  });

  return gaps.slice(0, 5); // max 5 per file to avoid noise
}

// ── Walker ────────────────────────────────────────────────────────────────────

function walkSrc(cwd: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (isIgnoredDirName(entry)) continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) { walk(full); continue; }
        const rel = relative(cwd, full);
        if (SOURCE_EXTS.includes(extname(entry)) && !isGeneratedArtifact(rel)) files.push(rel);
      } catch { /* skip */ }
    }
  };
  walk(cwd);
  return files;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function analyzeProjectDocs(cwd: string): DocsReport {
  const gaps: DocGap[] = [];
  const existingDocs: string[] = [];

  // 1. Required files
  for (const { file, severity, suggestion } of REQUIRED_FILES) {
    if (existsSync(join(cwd, file))) {
      existingDocs.push(file);
    } else {
      gaps.push({ type: 'missing-file', severity, description: `Missing ${file}`, suggestion, file });
    }
  }

  // 2. README sections
  const readmePath = join(cwd, 'README.md');
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, 'utf8');
    for (const { pattern, label, severity } of README_SECTIONS) {
      if (!pattern.test(readme)) {
        gaps.push({
          type: 'missing-section',
          severity,
          file: 'README.md',
          description: `README.md missing "${label}" section`,
          suggestion: `Add a ## ${label} section to README.md`,
        });
      }
    }
  }

  // 3. Undocumented exports (sample: top 20 files by path depth)
  const srcFiles = walkSrc(cwd).slice(0, 20);
  for (const file of srcFiles) {
    if (/\.(test|spec)\./.test(file)) continue;
    gaps.push(...findUndocumentedExports(cwd, file));
  }

  // Score: start at 100, deduct per gap
  const deductions = { high: 20, medium: 10, low: 3 };
  const score = Math.max(0, 100 - gaps.reduce((s, g) => s + deductions[g.severity], 0));

  const highCount = gaps.filter((g) => g.severity === 'high').length;
  const summary = highCount > 0
    ? `${gaps.length} documentation gaps found (${highCount} critical)`
    : `${gaps.length} documentation gaps found`;

  return { gaps, score, existingDocs, summary };
}
