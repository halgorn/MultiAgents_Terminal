import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeFixtureRepo } from '../test-utils/fixtures.js';
import { analyzeSeoAndCrawlers } from './seo-analyzer.js';

test('SEO analyzer reads Next.js source metadata and rendered build artifacts', () => {
  const cwd = makeFixtureRepo('aion-next-seo-');
  mkdirSync(join(cwd, 'src/app'), { recursive: true });
  mkdirSync(join(cwd, 'src/app/about'), { recursive: true });
  mkdirSync(join(cwd, '.next/server/app'), { recursive: true });
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }), 'utf8');
  writeFileSync(join(cwd, 'src/app/layout.tsx'), `
export const metadata = {
  title: 'Aion SEO Ready Application',
  description: 'A complete description long enough for crawler and search engine validation.',
  alternates: { canonical: 'https://example.com' },
  openGraph: { title: 'Aion', description: 'A complete description long enough for crawler and search engine validation.' },
  twitter: { card: 'summary_large_image' },
};
export default function Layout({ children }) { return <html><body>{children}</body></html>; }
`, 'utf8');
  writeFileSync(join(cwd, 'src/app/about/page.tsx'), `
export const metadata = {
  title: 'About Aion Platform',
  description: 'A route specific description long enough for search engine and crawler validation.',
  alternates: { canonical: 'https://example.com/about' },
  openGraph: { title: 'About Aion' },
};
export default function About() { return <main>About Aion with useful crawler readable content.</main>; }
`, 'utf8');
  writeFileSync(join(cwd, 'src/app/robots.ts'), `
export default function robots() {
  return { rules: [{ userAgent: 'GPTBot', allow: '/' }, { userAgent: 'ClaudeBot', allow: '/' }, { userAgent: 'Google-Extended', allow: '/' }] };
}
`, 'utf8');
  writeFileSync(join(cwd, 'src/app/sitemap.ts'), 'export default function sitemap() { return []; }', 'utf8');
  writeFileSync(join(cwd, '.next/server/app/index.html'), '<html><head><script type="application/ld+json">{}</script></head><body>Aion</body></html>', 'utf8');
  writeFileSync(join(cwd, '.next/server/app/sitemap.xml'), '<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/old</loc></url></urlset>', 'utf8');
  writeFileSync(join(cwd, '.next/server/app-paths-manifest.json'), JSON.stringify({ '/page': 'app/page.js', '/about/page': 'app/about/page.js' }), 'utf8');

  const report = analyzeSeoAndCrawlers(cwd);
  assert.equal(report.robotsTxt, true);
  assert.equal(report.sitemap, true);
  assert.equal(report.aiCrawlerPolicy, 'explicit');
  assert.ok(report.filesChecked >= 3);
  assert.equal(report.next?.framework, 'next');
  assert.equal(report.next?.routes.some((route) => route.route === '/about'), true);
  assert.equal(report.next?.sitemapMissingRoutes.includes('/about'), true);
  assert.equal(report.next?.sitemapUnknownUrls.includes('/old'), true);
  assert.equal(report.next?.crawlerPolicies.find((policy) => policy.crawler === 'GPTBot')?.status, 'allow');
  assert.equal(report.signals.some((signal) => signal.name === 'Next.js build awareness' && signal.status === 'ok'), true);
  assert.equal(report.signals.some((signal) => signal.name === 'Route SEO coverage'), true);
  assert.equal(report.issues.some((issue) => issue.issue.includes('No strong <title>')), false);
});
