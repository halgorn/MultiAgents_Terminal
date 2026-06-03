import type { Command } from 'commander';
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { GraphAgent } from '../../agents/graph-agent.js';
import { buildChurnReport } from '../../infra/git-analysis.js';
import { detectPatterns } from '../../infra/pattern-detect.js';
import { computeHealthScore } from '../../infra/health-score.js';
import { measureCognitiveLoad, buildApiMap, auditEnvVars, scanCurrentSecrets } from '../../infra/code-metrics.js';
import { buildSbom } from '../../infra/sbom.js';
import type { AuditReport } from '../../schemas/audit.js';
import type { HealthScore } from '../../infra/health-score.js';
import type { ChurnReport } from '../../infra/git-analysis.js';
import type { PatternReport } from '../../infra/pattern-detect.js';
import type { CognitiveEntry } from '../../infra/code-metrics.js';

function esc(s: string): string {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function loadLatestAudit(cwd: string): AuditReport | null {
  const dir = join(cwd, '.ai-runtime', 'reports');
  if (!existsSync(dir)) return null;
  try {
    const latest = join(dir, 'latest-audit.json');
    if (existsSync(latest)) {
      const pointer = JSON.parse(readFileSync(latest, 'utf8')) as { report?: string; runDir?: string };
      const reportPath = pointer.report ?? (pointer.runDir ? join(pointer.runDir, 'report.json') : undefined);
      if (reportPath && existsSync(reportPath)) {
        return JSON.parse(readFileSync(reportPath, 'utf8')) as AuditReport;
      }
    }
    const files = readdirSync(dir).filter((f) => f.startsWith('audit-') && f.endsWith('.json')).sort().reverse();
    if (!files[0]) return null;
    return JSON.parse(readFileSync(join(dir, files[0]), 'utf8')) as AuditReport;
  } catch { return null; }
}

function renderReport(data: {
  projectName: string;
  health: ReturnType<typeof computeHealthScore>;
  audit: AuditReport | null;
  churn: ReturnType<typeof buildChurnReport>;
  patterns: ReturnType<typeof detectPatterns>;
  cognitive: ReturnType<typeof measureCognitiveLoad>;
  graphExists: boolean;
  generatedAt: string;
}): string {
  const { projectName, health, audit, churn, patterns, cognitive } = data;
  const gradeColor = { A: '#3fb950', B: '#3fb950', C: '#e3b341', D: '#f85149', F: '#f85149' }[health.grade] ?? '#8b949e';

  const findingRows = (audit?.findings ?? []).slice(0, 50).map((f) => {
    const sevColor = { critical: '#f85149', high: '#e3b341', medium: '#79c0ff', low: '#8b949e', info: '#484f58' }[f.severity] ?? '#8b949e';
    return `<tr>
      <td><span class="badge" style="background:${sevColor}20;color:${sevColor}">${esc(f.severity)}</span></td>
      <td class="mono">${esc(f.file)}${f.line ? ':' + f.line : ''}</td>
      <td>${esc(f.category)}</td>
      <td>${esc(f.finding)}</td>
    </tr>`;
  }).join('');

  const churnRows = churn.churn.slice(0, 20).map((c) => {
    const riskColor = { critical: '#f85149', high: '#e3b341', medium: '#79c0ff', low: '#484f58' }[c.risk] ?? '#484f58';
    return `<tr>
      <td class="mono">${esc(c.file)}</td>
      <td style="color:${riskColor}">${c.commits}</td>
      <td>${c.authors}</td>
      <td><span class="badge" style="background:${riskColor}20;color:${riskColor}">${c.risk}</span></td>
    </tr>`;
  }).join('');

  const patternRows = patterns.detected.map((p) => `<tr>
    <td><strong>${esc(p.pattern)}</strong></td>
    <td>${esc(p.category)}</td>
    <td><span class="badge ${p.confidence}">${p.confidence}</span></td>
    <td>${p.evidence.filter(Boolean).map((e) => esc(e)).join('<br>')}</td>
  </tr>`).join('');

  const antiRows = patterns.antiPatterns.map((a) => `<tr>
    <td style="color:#f85149"><strong>${esc(a.name)}</strong></td>
    <td>${esc(a.severity)}</td>
    <td>${esc(a.description)}</td>
    <td>${a.evidence.slice(0, 2).map((e) => esc(e)).join('<br>')}</td>
  </tr>`).join('');

  const cogRows = cognitive.slice(0, 15).map((c) => `<tr>
    <td class="mono">${esc(c.file)}</td>
    <td style="color:${c.score>=40?'#f85149':c.score>=20?'#e3b341':'#3fb950'}">${c.score}</td>
    <td>${c.maxNesting}</td>
    <td>${c.longFunctions}</td>
    <td>${c.loc}</td>
  </tr>`).join('');

  const dimBars = health.dimensions.map((d) => {
    const pct = d.score;
    const color = pct >= 80 ? '#3fb950' : pct >= 60 ? '#e3b341' : '#f85149';
    return `<div class="dim-row">
      <div class="dim-name">${esc(d.name)}</div>
      <div class="dim-bar-wrap"><div class="dim-bar" style="width:${pct}%;background:${color}"></div></div>
      <div class="dim-score" style="color:${color}">${pct}</div>
      <div class="dim-detail">${esc(d.detail)}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(projectName)} — Project Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.6}
a{color:#79c0ff;text-decoration:none}.mono{font-family:monospace;font-size:12px}
nav{background:#161b22;border-bottom:1px solid #30363d;padding:12px 24px;display:flex;gap:20px;position:sticky;top:0;z-index:100}
nav a{color:#8b949e;font-size:13px}nav a:hover{color:#e6edf3}
.container{max-width:1200px;margin:0 auto;padding:24px}
h1{font-size:24px;margin-bottom:4px}h2{font-size:18px;margin:32px 0 16px;color:#79c0ff;border-bottom:1px solid #21262d;padding-bottom:8px}
h3{font-size:14px;color:#8b949e;margin-bottom:12px}
.header{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:24px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center}
.score-big{font-size:64px;font-weight:bold;color:${gradeColor};line-height:1}
.score-grade{font-size:32px;color:${gradeColor};margin-left:8px}
.meta{color:#8b949e;font-size:13px;margin-top:4px}
.dim-row{display:grid;grid-template-columns:140px 1fr 40px 1fr;gap:12px;align-items:center;margin:6px 0}
.dim-name{font-size:13px;color:#8b949e}.dim-bar-wrap{background:#21262d;border-radius:4px;height:8px}
.dim-bar{height:8px;border-radius:4px;transition:width 0.3s}.dim-score{font-size:13px;font-weight:bold;text-align:right}
.dim-detail{font-size:11px;color:#484f58}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 12px;border-bottom:2px solid #30363d;color:#8b949e;font-weight:600}
td{padding:8px 12px;border-bottom:1px solid #21262d;vertical-align:top}
tr:hover td{background:#161b22}.badge{display:inline-block;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600}
.badge.high{background:#3fb95020;color:#3fb950}.badge.medium{background:#e3b34120;color:#e3b341}.badge.low{background:#48495820;color:#8b949e}
.risk-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
.risk-card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.risk-card .num{font-size:32px;font-weight:bold}.risk-card .label{color:#8b949e;font-size:12px}
.rec-card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:12px}
.rec-card h4{color:#79c0ff;margin-bottom:6px}.rec-card ul{margin-left:16px;color:#8b949e;font-size:13px}
.section{margin-bottom:40px}
</style>
</head>
<body>
<nav>
  <a href="#health">Health</a>
  <a href="#audit">Audit</a>
  <a href="#patterns">Patterns</a>
  <a href="#churn">Churn</a>
  <a href="#cognitive">Complexity</a>
  ${data.graphExists ? '<a href="graph.html">Graph →</a>' : ''}
</nav>
<div class="container">
  <div class="header">
    <div>
      <h1>${esc(projectName)}</h1>
      <div class="meta">Generated ${esc(data.generatedAt)} · ${audit ? audit.totalFiles + ' files audited' : 'no audit data'}</div>
    </div>
    <div style="text-align:right">
      <span class="score-big">${health.total}</span><span class="score-grade">${health.grade}</span>
      <div class="meta">Health Score / 100</div>
    </div>
  </div>

  <div class="section" id="health">
    <h2>Health Dimensions</h2>
    ${dimBars}
    ${health.topRisks.length > 0 ? `<div style="margin-top:16px">${health.topRisks.map((r) => `<div style="color:#f85149;font-size:13px;margin:4px 0">✗ ${esc(r)}</div>`).join('')}</div>` : ''}
  </div>

  ${audit ? `<div class="section" id="audit">
    <h2>Audit Findings</h2>
    <div class="risk-grid">
      <div class="risk-card"><div class="num" style="color:#f85149">${audit.criticalCount}</div><div class="label">Critical</div></div>
      <div class="risk-card"><div class="num" style="color:#e3b341">${audit.highCount}</div><div class="label">High</div></div>
      <div class="risk-card"><div class="num">${audit.findings.length}</div><div class="label">Total Findings</div></div>
    </div>
    <p style="color:#8b949e;margin-bottom:16px;font-size:13px">${esc(audit.summary)}</p>
    <table><tr><th>Severity</th><th>Location</th><th>Category</th><th>Finding</th></tr>${findingRows}</table>
    ${audit.findings.length > 50 ? `<p style="color:#8b949e;font-size:12px;margin-top:8px">Showing 50 of ${audit.findings.length} findings</p>` : ''}
  </div>` : ''}

  <div class="section" id="patterns">
    <h2>Architecture Patterns</h2>
    ${patterns.detected.length > 0 ? `<h3>Detected</h3><table><tr><th>Pattern</th><th>Category</th><th>Confidence</th><th>Evidence</th></tr>${patternRows}</table>` : ''}
    ${patterns.antiPatterns.length > 0 ? `<h3 style="margin-top:20px">Anti-Patterns</h3><table><tr><th>Name</th><th>Severity</th><th>Description</th><th>Evidence</th></tr>${antiRows}</table>` : ''}
    ${patterns.recommendations.length > 0 ? `<h3 style="margin-top:20px">Recommendations</h3>${patterns.recommendations.map((r) => `<div class="rec-card"><h4>${esc(r.pattern)}</h4><p style="color:#8b949e;font-size:13px;margin-bottom:8px">${esc(r.reason)}</p><ul>${r.fixes.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`).join('')}` : ''}
  </div>

  ${churn.churn.length > 0 ? `<div class="section" id="churn">
    <h2>Git Churn (last ${churn.periodDays} days)</h2>
    <p style="color:#8b949e;font-size:13px;margin-bottom:16px">${churn.totalCommits} total commits</p>
    <table><tr><th>File</th><th>Commits</th><th>Authors</th><th>Risk</th></tr>${churnRows}</table>
  </div>` : ''}

  ${cognitive.length > 0 ? `<div class="section" id="cognitive">
    <h2>Cognitive Load</h2>
    <table><tr><th>File</th><th>Score</th><th>Max Nesting</th><th>Long Functions</th><th>LOC</th></tr>${cogRows}</table>
  </div>` : ''}

</div>
</body>
</html>`;
}

function renderMarkdown(data: {
  projectName: string;
  health: HealthScore;
  audit: AuditReport | null;
  churn: ChurnReport;
  patterns: PatternReport;
  cognitive: CognitiveEntry[];
  generatedAt: string;
  totalFiles: number;
  totalSymbols: number;
  cycles: number;
  hotspots: Array<{ file: string; fanIn: number; fanOut: number }>;
  apiEndpoints: ReturnType<typeof buildApiMap>;
  envAudit: ReturnType<typeof auditEnvVars>;
  secrets: ReturnType<typeof scanCurrentSecrets>;
  sbom: ReturnType<typeof buildSbom>;
}): string {
  const { projectName, health, audit, churn, patterns, cognitive, hotspots, apiEndpoints, envAudit, secrets, sbom } = data;
  const lines: string[] = [];

  lines.push(`# ${projectName} — AI Analysis Context`);
  lines.push(`> Generated: ${data.generatedAt} · Use this document to ask an AI for refactoring, architecture, and improvement recommendations.`);
  lines.push('');

  // Health
  lines.push(`## Health Score: ${health.total}/100 (${health.grade})`);
  lines.push('');
  lines.push('| Dimension | Score | Detail |');
  lines.push('|---|---|---|');
  health.dimensions.forEach((d) => lines.push(`| ${d.name} | ${d.score}/100 | ${d.detail} |`));
  lines.push('');
  if (health.topRisks.length > 0) {
    lines.push('**Top risks:**');
    health.topRisks.forEach((r) => lines.push(`- ${r}`));
    lines.push('');
  }

  // Project overview
  lines.push('## Project Overview');
  lines.push(`- **Files:** ${data.totalFiles} | **Symbols:** ${data.totalSymbols}`);
  lines.push(`- **Dependency cycles:** ${data.cycles}`);
  lines.push(`- **Git commits (90d):** ${churn.totalCommits}`);
  lines.push('');

  // Architecture patterns
  lines.push('## Architecture Patterns');
  lines.push('');
  lines.push('### Detected');
  patterns.detected.forEach((p) => {
    lines.push(`- **${p.pattern}** [${p.category}] (${p.confidence} confidence): ${p.evidence.filter(Boolean).join(', ')}`);
  });
  lines.push('');

  if (patterns.antiPatterns.length > 0) {
    lines.push('### Anti-Patterns');
    patterns.antiPatterns.forEach((a) => {
      lines.push(`- **${a.name}** [${a.severity}]: ${a.description}`);
      a.evidence.slice(0, 2).forEach((e) => lines.push(`  - \`${e}\``));
    });
    lines.push('');
  }

  if (patterns.recommendations.length > 0) {
    lines.push('### Recommendations');
    patterns.recommendations.forEach((r) => {
      lines.push(`- **${r.pattern}** [${r.priority} priority]: ${r.reason}`);
      r.fixes.forEach((f) => lines.push(`  - ${f}`));
    });
    lines.push('');
  }

  // Hotspots
  if (hotspots.length > 0) {
    lines.push('## Hotspot Files (Highest Coupling)');
    lines.push('');
    lines.push('| File | FanIn | FanOut | Risk |');
    lines.push('|---|---|---|---|');
    hotspots.slice(0, 10).forEach((h) => {
      const risk = h.fanIn >= 30 ? 'CRITICAL' : h.fanIn >= 15 ? 'HIGH' : 'MEDIUM';
      lines.push(`| \`${h.file}\` | ${h.fanIn} | ${h.fanOut} | ${risk} |`);
    });
    lines.push('');
  }

  // Audit findings
  if (audit) {
    lines.push('## Audit Findings');
    lines.push(`**${audit.criticalCount} critical · ${audit.highCount} high · ${audit.findings.length} total**`);
    lines.push('');
    lines.push(audit.summary);
    lines.push('');

    const critical = audit.findings.filter((f) => f.severity === 'critical');
    const high = audit.findings.filter((f) => f.severity === 'high');

    if (critical.length > 0) {
      lines.push('### Critical Findings');
      critical.forEach((f) => {
        const persona = f.persona ? ` (persona: ${f.persona})` : '';
        lines.push(`- \`${f.file}${f.line ? ':' + f.line : ''}\` [${f.category}]${persona} ${f.finding}`);
        lines.push(`  → ${f.recommendation}`);
      });
      lines.push('');
    }

    if (high.length > 0) {
      lines.push('### High Findings');
      high.slice(0, 15).forEach((f) => {
        const persona = f.persona ? ` (persona: ${f.persona})` : '';
        lines.push(`- \`${f.file}${f.line ? ':' + f.line : ''}\` [${f.category}]${persona} ${f.finding}`);
        lines.push(`  → ${f.recommendation}`);
      });
      lines.push('');
    }
  }

  // Churn
  if (churn.churn.length > 0) {
    lines.push('## Git Churn (90 days)');
    lines.push('');
    lines.push('| File | Commits | Authors | Risk |');
    lines.push('|---|---|---|---|');
    churn.churn.slice(0, 15).forEach((c) => lines.push(`| \`${c.file}\` | ${c.commits} | ${c.authors} | ${c.risk} |`));
    lines.push('');

    const intersection = churn.busFactor
      .filter((b) => b.risk === 'critical')
      .filter((b) => churn.churn.find((c) => c.file === b.file && (c.risk === 'critical' || c.risk === 'high')));
    if (intersection.length > 0) {
      lines.push('### High Risk: High Churn + Single Author');
      intersection.forEach((b) => lines.push(`- \`${b.file}\` — ${b.primaryPercent}% commits by one author`));
      lines.push('');
    }
  }

  // API Map (no-auth endpoints)
  const noAuthEndpoints = apiEndpoints.filter((e) => !e.hasAuth);
  if (noAuthEndpoints.length > 0) {
    lines.push('## Unprotected API Endpoints');
    lines.push('');
    noAuthEndpoints.forEach((e) => {
      lines.push(`- \`${e.method} ${e.path}\` — \`${e.file}:${e.line}\``);
    });
    lines.push('');
  }

  // Undocumented env vars
  if (envAudit.undocumented.length > 0) {
    lines.push('## Undocumented Environment Variables');
    lines.push(`${envAudit.undocumented.length} variables used in code but not in .env.example:`);
    lines.push('');
    envAudit.undocumented.slice(0, 20).forEach((v) => lines.push(`- \`${v}\``));
    lines.push('');
  }

  // Secrets
  if (secrets.length > 0) {
    lines.push('## Hardcoded Secrets Detected');
    secrets.forEach((s) => lines.push(`- \`${s.file}:${s.line}\` [${s.pattern}]`));
    lines.push('');
  }

  // Cognitive load
  if (cognitive.length > 0) {
    lines.push('## High Cognitive Load Files');
    lines.push('');
    lines.push('| File | Score | Max Nesting | Long Functions | LOC |');
    lines.push('|---|---|---|---|---|');
    cognitive.slice(0, 10).forEach((c) => lines.push(`| \`${c.file}\` | ${c.score} | ${c.maxNesting} | ${c.longFunctions} | ${c.loc} |`));
    lines.push('');
  }

  // SBOM unpinned
  if (sbom.unpinned.length > 0) {
    lines.push('## Unpinned Dependencies (Supply Chain Risk)');
    sbom.unpinned.slice(0, 20).forEach((p) => lines.push(`- \`${p.lang}\` \`${p.name}\` ${p.version}`));
    lines.push('');
  }

  // AI prompt footer
  lines.push('---');
  lines.push('## Suggested AI Prompts');
  lines.push('');
  lines.push('Copy this document and use with any of these prompts:');
  lines.push('');
  lines.push('- *"Based on this analysis, create a prioritized refactoring roadmap with effort estimates"*');
  lines.push('- *"Propose a migration plan from the current architecture to Clean Architecture + Repository Pattern"*');
  lines.push('- *"Which critical findings should be fixed first and why? Write the fixes."*');
  lines.push('- *"Identify which hotspot files should be split and how"*');
  lines.push('- *"What tests should be written first given the 7% test coverage and these hotspots?"*');

  return lines.join('\n');
}

export function registerReport(program: Command): void {
  program
    .command('report')
    .description('Generate full HTML + Markdown project report')
    .option('--no-open', 'generate without opening browser')
    .option('--md', 'generate only Markdown (AI-ready context file)')
    .option('--days <n>', 'git lookback for churn analysis', '90')
    .action(async (options: { open: boolean; md?: boolean; days: string }) => {
      const cwd = process.cwd();
      const days = parseInt(options.days, 10) || 90;
      const projectName = cwd.split('/').pop() ?? 'project';
      console.log(`Building report for ${projectName}…`);

      const graph = new GraphAgent(cwd);
      const index = await graph.ensureIndex();

      let hotspots: Array<{ file: string; fanIn: number; fanOut: number }> = [];
      try {
        const { detectLang } = await import('../../infra/lang-detect.js');
        const { buildDepGraph } = await import('../../infra/dep-graph.js');
        const { buildPythonDepGraph } = await import('../../infra/dep-graph-python.js');
        const lang = detectLang(cwd);
        const dep = lang.lang === 'python' ? buildPythonDepGraph(cwd) : buildDepGraph(cwd);
        hotspots = dep.hotspots;
      } catch { /* best-effort */ }

      const audit = loadLatestAudit(cwd);
      const churn = buildChurnReport(cwd, hotspots.map((h) => h.file), days);
      const patterns = detectPatterns(cwd, hotspots);
      const cognitive = measureCognitiveLoad(cwd, 30);
      const apiEndpoints = buildApiMap(cwd);
      const envAudit = auditEnvVars(cwd);
      const secrets = scanCurrentSecrets(cwd);
      const sbom = buildSbom(cwd);

      let cycles = 0;
      try {
        const { detectLang } = await import('../../infra/lang-detect.js');
        const { buildDepGraph } = await import('../../infra/dep-graph.js');
        const { buildPythonDepGraph } = await import('../../infra/dep-graph-python.js');
        const lang = detectLang(cwd);
        const dep = lang.lang === 'python' ? buildPythonDepGraph(cwd) : buildDepGraph(cwd);
        cycles = dep.cycles.length;
      } catch { /* best-effort */ }

      const health = computeHealthScore({
        totalFiles: index.stats.files, totalSymbols: index.stats.symbols,
        cycles, hotspots: hotspots.length,
        testFileRatio: index.files.filter((f) => f.isTest).length / Math.max(index.files.length, 1),
        churn: churn.churn, busFactor: churn.busFactor, cognitiveLoad: cognitive,
        patterns, auditCriticals: audit?.criticalCount, auditHighs: audit?.highCount,
      });

      const outDir = join(cwd, '.ai-runtime');
      mkdirSync(outDir, { recursive: true });
      const generatedAt = new Date().toLocaleString();
      const mdData = { projectName, health, audit, churn, patterns, cognitive, generatedAt,
        totalFiles: index.stats.files, totalSymbols: index.stats.symbols, cycles,
        hotspots, apiEndpoints, envAudit, secrets, sbom };

      // Always generate markdown
      const md = renderMarkdown(mdData);
      const mdFile = join(outDir, 'context.md');
      writeFileSync(mdFile, md, 'utf8');
      console.log(`Markdown: ${mdFile}`);

      if (!options.md) {
        const graphExists = existsSync(join(outDir, 'graph.html'));
        const html = renderReport({ projectName, health, audit, churn, patterns, cognitive, graphExists, generatedAt });
        const outFile = join(outDir, 'report.html');
        writeFileSync(outFile, html, 'utf8');
        console.log(`HTML:     ${outFile}`);

        if (options.open !== false) {
          const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
          const args = process.platform === 'win32' ? ['/c', 'start', '', outFile] : [outFile];
          spawnSync(opener, args, { stdio: 'ignore', timeout: 5000 });
        }
      }

      console.log(`  Health: ${health.badge}`);
      if (audit) console.log(`  Findings: ${audit.criticalCount} critical, ${audit.highCount} high`);
      console.log(`  Size: ~${Math.round(md.length / 1000)}k chars (~${Math.round(md.length / 4)} tokens)`);
    });
}
