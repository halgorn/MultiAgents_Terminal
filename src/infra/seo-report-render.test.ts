import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSeoMarkdown, renderSeoHtml } from './seo-report-render.js';
import type { SeoCrawlerReport } from './seo-analyzer.js';

const BASE: SeoCrawlerReport = {
  score: 80,
  filesChecked: 10,
  robotsTxt: true,
  sitemap: true,
  googleAnalytics: false,
  googleTagManager: false,
  searchConsole: false,
  aiCrawlerPolicy: 'explicit',
  signals: [],
  issues: [],
};

// ── renderSeoMarkdown ─────────────────────────────────────────────────────────

test('renderSeoMarkdown: includes score in header', () => {
  const md = renderSeoMarkdown(BASE);
  assert.ok(md.includes('80/100'), md);
  assert.ok(md.includes('## SEO'), md);
});

test('renderSeoMarkdown: robots.txt present / missing', () => {
  const present = renderSeoMarkdown(BASE);
  assert.ok(present.includes('robots.txt: present'), present);
  const missing = renderSeoMarkdown({ ...BASE, robotsTxt: false });
  assert.ok(missing.includes('robots.txt: missing'), missing);
});

test('renderSeoMarkdown: sitemap present / missing', () => {
  const present = renderSeoMarkdown(BASE);
  assert.ok(present.includes('sitemap: present'), present);
  const missing = renderSeoMarkdown({ ...BASE, sitemap: false });
  assert.ok(missing.includes('sitemap: missing'), missing);
});

test('renderSeoMarkdown: AI crawler policy value is shown', () => {
  const md = renderSeoMarkdown({ ...BASE, aiCrawlerPolicy: 'missing' });
  assert.ok(md.includes('AI crawler policy: missing'), md);
});

test('renderSeoMarkdown: analytics detected when googleAnalytics is true', () => {
  const md = renderSeoMarkdown({ ...BASE, googleAnalytics: true });
  assert.ok(md.includes('detected'), md);
});

test('renderSeoMarkdown: no issues section when issues array is empty', () => {
  const md = renderSeoMarkdown(BASE);
  assert.ok(!md.includes('| Severity |'), 'issues table should be absent when empty');
});

test('renderSeoMarkdown: issues table present when there are issues', () => {
  const seo = { ...BASE, issues: [{ severity: 'high' as const, area: 'robots', issue: 'No AI policy', recommendation: 'Add GPTBot rule' }] };
  const md = renderSeoMarkdown(seo);
  assert.ok(md.includes('| Severity |'), md);
  assert.ok(md.includes('No AI policy'), md);
});

test('renderSeoMarkdown: no Next.js section when next is absent', () => {
  const md = renderSeoMarkdown(BASE);
  assert.ok(!md.includes('Next.js routes:'), md);
});

// ── renderSeoHtml ─────────────────────────────────────────────────────────────

test('renderSeoHtml: wraps in <section id="seo">', () => {
  const html = renderSeoHtml(BASE);
  assert.ok(html.startsWith('<section id="seo">'), html.slice(0, 50));
});

test('renderSeoHtml: score appears in output', () => {
  const html = renderSeoHtml(BASE);
  assert.ok(html.includes('80/100'), html);
});

test('renderSeoHtml: HTML-escapes signal detail to prevent XSS', () => {
  const seo: SeoCrawlerReport = {
    ...BASE,
    signals: [{ name: 'test', status: 'ok', detail: '<script>alert(1)</script>' }],
  };
  const html = renderSeoHtml(seo);
  assert.ok(!html.includes('<script>alert'), 'raw script tag must be escaped');
  assert.ok(html.includes('&lt;script&gt;'), html);
});

test('renderSeoHtml: HTML-escapes issue text to prevent XSS', () => {
  const seo: SeoCrawlerReport = {
    ...BASE,
    issues: [{ severity: 'high' as const, area: 'test', issue: '<img src=x onerror=alert(1)>', recommendation: 'fix' }],
  };
  const html = renderSeoHtml(seo);
  assert.ok(!html.includes('<img src=x'), 'raw img tag must be escaped');
});

test('renderSeoHtml: "no issues" fallback row present when issues empty', () => {
  const html = renderSeoHtml(BASE);
  assert.ok(html.includes('No SEO/crawler issues detected'), html);
});
