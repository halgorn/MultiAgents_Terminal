import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AuditFinding, AuditReport } from '../schemas/audit.js';
import { SEVERITY_RANK } from './audit-model.js';
import { displayProjectName } from './project-name.js';

interface DomainSnapshot {
  domain: string;
  scannedAt: string;
  findings: AuditFinding[];
  summary: string;
  totalFiles: number;
}

const DOMAIN_LABELS: Record<string, string> = {
  security: 'Security',
  bugs: 'Bugs',
  architecture: 'Architecture',
  testing: 'Tests',
  performance: 'Performance',
  observability: 'Observability',
  resilience: 'Resilience',
  compliance: 'Compliance',
  dependencies: 'Dependencies',
  infrastructure: 'Infrastructure',
  data: 'Data',
  redundancy: 'Redundancy',
  local: 'Local',
};

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function domainsDir(cwd: string): string {
  return join(cwd, '.ai-runtime', 'reports', 'domains');
}

export function projectReportPath(cwd: string): string {
  return join(cwd, '.ai-runtime', 'reports', 'project.html');
}

function loadAllDomains(cwd: string): DomainSnapshot[] {
  const dir = domainsDir(cwd);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        try { return JSON.parse(readFileSync(join(dir, file), 'utf8')) as DomainSnapshot; } catch { return null; }
      })
      .filter((item): item is DomainSnapshot => item !== null)
      .sort((a, b) => a.domain.localeCompare(b.domain));
  } catch {
    return [];
  }
}

function writeDomainSnapshot(dir: string, domain: string, report: AuditReport, findings: AuditFinding[], scannedAt: string): void {
  const snapshot: DomainSnapshot = {
    domain,
    scannedAt,
    findings,
    summary: report.summary,
    totalFiles: report.totalFiles,
  };
  writeFileSync(join(dir, `${domain}.json`), JSON.stringify(snapshot, null, 2), 'utf8');
}

export function saveDomainSnapshot(cwd: string, report: AuditReport): void {
  const dir = domainsDir(cwd);
  mkdirSync(dir, { recursive: true });
  const scannedAt = new Date().toISOString();
  if ((report.sections ?? []).length > 0) {
    for (const section of report.sections ?? []) writeDomainSnapshot(dir, section.domain, report, section.findings, scannedAt);
  } else {
    const byCategory = new Map<string, AuditFinding[]>();
    for (const finding of report.findings) {
      const key = finding.category || 'local';
      byCategory.set(key, [...(byCategory.get(key) ?? []), finding]);
    }
    for (const [domain, findings] of byCategory) writeDomainSnapshot(dir, domain, report, findings, scannedAt);
  }
  rebuildProjectHtml(cwd);
}

function ageLabel(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

function renderFinding(finding: AuditFinding): string {
  const loc = finding.file ? `${finding.file}${finding.line ? ':' + finding.line : ''}` : '';
  return `<article class="finding sev-${esc(finding.severity)}">
    <div><strong>${esc(finding.severity.toUpperCase())}</strong> ${esc(finding.finding)}</div>
    ${loc ? `<code>${esc(loc)}</code>` : ''}
    ${finding.recommendation ? `<p>${esc(finding.recommendation)}</p>` : ''}
  </article>`;
}

function renderDomain(snapshot: DomainSnapshot, index: number): string {
  const findings = [...snapshot.findings].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
  const label = DOMAIN_LABELS[snapshot.domain] ?? snapshot.domain;
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const high = findings.filter((f) => f.severity === 'high').length;
  return `<section class="panel${index === 0 ? ' active' : ''}" id="panel-${index}">
    <header><h2>${esc(label)}</h2><span>${findings.length} total · ${critical} critical · ${high} high · ${esc(ageLabel(snapshot.scannedAt))}</span></header>
    <div class="findings">${findings.length ? findings.map(renderFinding).join('') : '<div class="empty">No findings in this domain.</div>'}</div>
  </section>`;
}

export function rebuildProjectHtml(cwd: string): void {
  const domains = loadAllDomains(cwd);
  const projectName = displayProjectName(cwd);
  const totalFindings = domains.reduce((sum, domain) => sum + domain.findings.length, 0);
  const totalCritical = domains.reduce((sum, domain) => sum + domain.findings.filter((f) => f.severity === 'critical').length, 0);
  const totalHigh = domains.reduce((sum, domain) => sum + domain.findings.filter((f) => f.severity === 'high').length, 0);
  const tabs = domains.map((domain, index) => `<button class="${index === 0 ? 'active' : ''}" onclick="showPanel(${index})">${esc(DOMAIN_LABELS[domain.domain] ?? domain.domain)} <b>${domain.findings.length}</b></button>`).join('');
  const panels = domains.map(renderDomain).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Aion · ${esc(projectName)}</title><style>
body{margin:0;background:#101419;color:#e0e2ea;font:14px/1.5 Inter,system-ui,sans-serif}header.top{position:sticky;top:0;background:#181c21;border-bottom:1px solid #414752;padding:16px 24px;z-index:2}
.brand{font-size:22px;font-weight:900;color:#a2c9ff}.wrap{max-width:1180px;margin:auto;padding:24px}.hero{display:grid;grid-template-columns:2fr repeat(3,1fr);gap:12px;margin-bottom:18px}
.card,.panel,.empty{background:#181c21;border:1px solid #414752;border-radius:8px;padding:16px}.metric{font-size:32px;font-weight:800}.muted,header span{color:#8b919d}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.tabs button{background:#272a30;color:#c0c7d4;border:1px solid #414752;border-radius:8px;padding:8px 10px}.tabs button.active{color:#a2c9ff;border-color:#58a6ff}
.panel{display:none}.panel.active{display:block}.panel header{display:flex;justify-content:space-between;gap:12px;align-items:center;border-bottom:1px solid #414752;margin-bottom:12px}.finding{border-left:4px solid #8b919d;background:#1c2025;margin:10px 0;padding:12px;border-radius:8px}.finding.sev-critical{border-color:#ffb4ab}.finding.sev-high{border-color:#ffba42}.finding code{display:inline-block;margin-top:8px;color:#c0c7d4}.finding p{color:#c0c7d4;margin:8px 0 0}
@media(max-width:800px){.hero{grid-template-columns:1fr}.panel header{display:block}}</style></head><body>
<header class="top"><span class="brand">Aion</span> <span>· ${esc(projectName)} audit dashboard</span></header>
<main class="wrap"><section class="hero"><div class="card"><h1>Audit Report</h1><p class="muted">${domains.length} scanned domain${domains.length !== 1 ? 's' : ''}</p></div>
<div class="card"><div class="metric">${totalFindings}</div><div class="muted">Findings</div></div><div class="card"><div class="metric">${totalCritical}</div><div class="muted">Critical</div></div><div class="card"><div class="metric">${totalHigh}</div><div class="muted">High</div></div></section>
<nav class="tabs">${tabs || '<span class="muted">No scans yet.</span>'}</nav>${panels || '<div class="empty">Run aion and choose an audit category.</div>'}</main>
<script>function showPanel(i){document.querySelectorAll('.tabs button').forEach((b,j)=>b.classList.toggle('active',j===i));document.querySelectorAll('.panel').forEach((p,j)=>p.classList.toggle('active',j===i));}</script></body></html>`;
  writeFileSync(projectReportPath(cwd), html, 'utf8');
}
