import type { SeoCrawlerReport } from './seo-analyzer.js';

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderSeoMarkdown(seo: SeoCrawlerReport): string {
  const lines = [`## SEO, Analytics & Crawlers: ${seo.score}/100`];
  lines.push(`- robots.txt: ${seo.robotsTxt ? 'present' : 'missing'}`);
  lines.push(`- sitemap: ${seo.sitemap ? 'present' : 'missing'}`);
  lines.push(`- AI crawler policy: ${seo.aiCrawlerPolicy}`);
  lines.push(`- Google Analytics/GTM: ${seo.googleAnalytics || seo.googleTagManager ? 'detected' : 'not detected'}`);
  lines.push(`- Search Console: ${seo.searchConsole ? 'detected' : 'not detected'}`);
  if (seo.next?.framework) {
    lines.push(`- Next.js routes: ${seo.next.routes.length}`);
    lines.push(`- Next.js build routes: ${seo.next.buildRoutes.length}`);
    lines.push(`- Sitemap gaps: ${seo.next.sitemapMissingRoutes.length}`);
    lines.push('', '| Route | Rendering | SEO Issues | HTML | Scripts |', '|---|---|---|---|---|');
    seo.next.routes.slice(0, 20).forEach((route) => lines.push(`| ${route.route} | ${route.rendering} | ${route.issues.join(', ') || 'ok'} | ${route.htmlBytes} bytes | ${route.scriptCount} |`));
  }
  if (seo.issues.length > 0) {
    lines.push('', '| Severity | Area | Issue | Recommendation |', '|---|---|---|---|');
    seo.issues.slice(0, 10).forEach((issue) => lines.push(`| ${issue.severity} | ${issue.area} | ${issue.issue} | ${issue.recommendation} |`));
  }
  return lines.join('\n');
}

export function renderSeoHtml(seo: SeoCrawlerReport): string {
  const signalRows = seo.signals.map((signal) => `<tr><td>${esc(signal.name)}</td><td><span class="${signal.status === 'ok' ? 'ok' : signal.status === 'warn' ? 'warn' : 'sev-high'}">${esc(signal.status)}</span></td><td>${esc(signal.detail)}</td></tr>`).join('');
  const issueRows = seo.issues.map((issue) => `<tr><td>${esc(issue.severity)}</td><td>${esc(issue.area)}</td><td>${esc(issue.issue)}</td><td>${esc(issue.recommendation)}</td></tr>`).join('');
  const next = seo.next;
  const crawlerRows = next?.crawlerPolicies.map((policy) => `<tr><td>${esc(policy.crawler)}</td><td><span class="${policy.status === 'allow' ? 'ok' : policy.status === 'block' ? 'sev-high' : 'warn'}">${policy.status}</span></td></tr>`).join('') ?? '';
  const routeRows = next?.routes.slice(0, 50).map((route) => `<tr><td class="mono">${esc(route.route)}</td><td>${route.rendering}</td><td>${route.title ? 'yes' : 'no'}</td><td>${route.description ? 'yes' : 'no'}</td><td>${route.canonical ? 'yes' : 'no'}</td><td>${route.openGraph ? 'yes' : 'no'}</td><td>${route.jsonLd ? 'yes' : 'no'}</td><td>${route.htmlBytes}</td><td>${route.scriptCount}</td><td>${esc(route.issues.join(', ') || 'ok')}</td></tr>`).join('') ?? '';
  const sitemapRows = next ? [...next.sitemapMissingRoutes.slice(0, 20).map((route) => `<tr><td>missing from sitemap</td><td class="mono">${esc(route)}</td></tr>`), ...next.sitemapUnknownUrls.slice(0, 20).map((url) => `<tr><td>unknown sitemap URL</td><td class="mono">${esc(url)}</td></tr>`)].join('') : '';
  const nextSection = !next?.framework ? '' : `
<h3>Next.js Route Analysis</h3><div class="grid"><div class="card"><strong>${next.routes.length}</strong><br>Routes</div><div class="card"><strong>${next.buildRoutes.length}</strong><br>Rendered build routes</div><div class="card"><strong>${next.manifestRoutes.length}</strong><br>Manifest routes</div><div class="card"><strong class="${next.sitemapMissingRoutes.length ? 'warn' : 'ok'}">${next.sitemapMissingRoutes.length}</strong><br>Sitemap gaps</div></div>
<table><tr><th>Route</th><th>Rendering</th><th>Title</th><th>Description</th><th>Canonical</th><th>OG</th><th>JSON-LD</th><th>HTML bytes</th><th>Scripts</th><th>Issues</th></tr>${routeRows || '<tr><td colspan="10">No Next.js routes detected.</td></tr>'}</table>
<h3>AI & Google Crawler Policy</h3><table><tr><th>Crawler</th><th>Status</th></tr>${crawlerRows}</table>
<h3>Sitemap vs Routes</h3><table><tr><th>Type</th><th>Path</th></tr>${sitemapRows || '<tr><td colspan="2">No sitemap/route mismatch detected.</td></tr>'}</table>`;
  return `<section id="seo"><h2>SEO, Analytics & AI Crawlers</h2><div class="grid"><div class="card"><strong class="${seo.score >= 80 ? 'ok' : seo.score >= 60 ? 'warn' : 'sev-high'}">${seo.score}/100</strong><br>SEO score</div><div class="card"><strong class="${seo.robotsTxt ? 'ok' : 'sev-high'}">${seo.robotsTxt ? 'yes' : 'no'}</strong><br>robots.txt</div><div class="card"><strong class="${seo.sitemap ? 'ok' : 'sev-high'}">${seo.sitemap ? 'yes' : 'no'}</strong><br>sitemap</div><div class="card"><strong>${esc(seo.aiCrawlerPolicy)}</strong><br>AI crawler policy</div></div>
<h3>Crawler & Analytics Signals</h3><table><tr><th>Signal</th><th>Status</th><th>Detail</th></tr>${signalRows}</table>
${nextSection}
<h3>SEO Issues</h3><table><tr><th>Severity</th><th>Area</th><th>Issue</th><th>Recommendation</th></tr>${issueRows || '<tr><td colspan="4">No SEO/crawler issues detected.</td></tr>'}</table></section>`;
}
