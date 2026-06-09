import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative } from 'path';
import { isGeneratedArtifact, isIgnoredDirName } from '../cli/cli-utils.js';

export interface SeoSignal {
  name: string;
  status: 'ok' | 'warn' | 'missing';
  detail: string;
}

export interface SeoIssue {
  severity: 'high' | 'medium' | 'low';
  area: string;
  issue: string;
  recommendation: string;
}

export interface SeoCrawlerReport {
  score: number;
  filesChecked: number;
  robotsTxt: boolean;
  sitemap: boolean;
  googleAnalytics: boolean;
  googleTagManager: boolean;
  searchConsole: boolean;
  aiCrawlerPolicy: 'explicit' | 'partial' | 'missing';
  signals: SeoSignal[];
  issues: SeoIssue[];
}

const WEB_EXTS = new Set(['.html', '.htm', '.tsx', '.jsx', '.vue', '.svelte', '.astro', '.mdx']);
const NEXT_SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const NEXT_BUILD_EXTS = new Set(['.html', '.txt', '.xml', '.json']);
const AI_CRAWLERS = ['GPTBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'PerplexityBot', 'CCBot', 'Google-Extended'];
const GOOGLE_CRAWLERS = ['Googlebot', 'Googlebot-Image', 'AdsBot-Google'];

function readOptional(cwd: string, path: string): string {
  try { return readFileSync(join(cwd, path), 'utf8'); } catch { return ''; }
}

function walkWebFiles(cwd: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (isIgnoredDirName(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relative(cwd, full);
      if (entry.isDirectory()) { walk(full); continue; }
      if (isGeneratedArtifact(rel)) continue;
      if (WEB_EXTS.has(extname(entry.name))) files.push(rel);
    }
  };
  walk(cwd);
  return files.slice(0, 200);
}

function walkLimited(cwd: string, roots: string[], exts: Set<string>, limit: number): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    if (files.length >= limit) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= limit) break;
      const full = join(dir, entry.name);
      const rel = relative(cwd, full);
      if (entry.isDirectory()) { walk(full); continue; }
      if (exts.has(extname(entry.name))) files.push(rel);
    }
  };
  roots.forEach((root) => existsSync(join(cwd, root)) && walk(join(cwd, root)));
  return files;
}

function findNextSourceFiles(cwd: string): string[] {
  return walkLimited(cwd, ['app', 'pages', 'src/app', 'src/pages'], NEXT_SOURCE_EXTS, 160);
}

function findNextBuildFiles(cwd: string): string[] {
  return walkLimited(cwd, ['.next/server/app', '.next/server/pages'], NEXT_BUILD_EXTS, 120);
}

function hasAny(content: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(content));
}

function pushIssue(issues: SeoIssue[], severity: SeoIssue['severity'], area: string, issue: string, recommendation: string): void {
  issues.push({ severity, area, issue, recommendation });
}

export function analyzeSeoAndCrawlers(cwd: string): SeoCrawlerReport {
  const files = walkWebFiles(cwd);
  const packageJson = readOptional(cwd, 'package.json');
  const nextConfig = readOptional(cwd, 'next.config.js') || readOptional(cwd, 'next.config.mjs') || readOptional(cwd, 'next.config.ts');
  const isNext = /"next"\s*:|next build|next dev/i.test(packageJson) || Boolean(nextConfig);
  const nextSourceFiles = isNext ? findNextSourceFiles(cwd) : [];
  const nextBuildFiles = isNext ? findNextBuildFiles(cwd) : [];
  const pageCorpus = [...new Set([...files, ...nextSourceFiles, ...nextBuildFiles])].map((file) => readOptional(cwd, file)).join('\n');
  const nextRobotsSource = readOptional(cwd, 'app/robots.ts') || readOptional(cwd, 'src/app/robots.ts') || readOptional(cwd, 'app/robots.js') || readOptional(cwd, 'src/app/robots.js');
  const robots = readOptional(cwd, 'robots.txt') || readOptional(cwd, 'public/robots.txt') || readOptional(cwd, 'static/robots.txt')
    || readOptional(cwd, '.next/server/app/robots.txt') || nextRobotsSource;
  const sitemap = existsSync(join(cwd, 'sitemap.xml')) || existsSync(join(cwd, 'public/sitemap.xml')) || existsSync(join(cwd, 'static/sitemap.xml'))
    || existsSync(join(cwd, '.next/server/app/sitemap.xml')) || existsSync(join(cwd, 'app/sitemap.ts')) || existsSync(join(cwd, 'src/app/sitemap.ts'))
    || existsSync(join(cwd, 'app/sitemap.js')) || existsSync(join(cwd, 'src/app/sitemap.js')) || /Sitemap:\s*\S+/i.test(robots);
  const corpus = `${pageCorpus}\n${packageJson}\n${nextConfig}\n${robots}`;

  const title = /<title\b[^>]*>[^<]{8,}<\/title>/i.test(pageCorpus) || /\btitle\s*:\s*['"`][^'"`]{8,}['"`]/i.test(pageCorpus);
  const metaDescription = /<meta\s+[^>]*name=["']description["'][^>]*content=["'][^"']{40,}["']/i.test(pageCorpus)
    || /\bdescription\s*:\s*['"`][^'"`]{40,}['"`]/i.test(pageCorpus);
  const canonical = /rel=["']canonical["']/i.test(pageCorpus) || /canonical\s*:\s*['"`][^'"`]+['"`]/i.test(pageCorpus);
  const openGraph = /property=["']og:/i.test(pageCorpus) || /openGraph\s*:/i.test(pageCorpus);
  const twitterCard = /name=["']twitter:card["']/i.test(pageCorpus) || /twitter\s*:/i.test(pageCorpus);
  const jsonLd = /application\/ld\+json/i.test(pageCorpus) || /schema\.org|JsonLd|structuredData/i.test(pageCorpus);
  const hreflang = /hreflang=["'][^"']+["']/i.test(pageCorpus);
  const googleAnalytics = hasAny(corpus, [/G-[A-Z0-9]{5,}/, /google-analytics\.com\/(?:analytics|gtag)\.js/i, /gtag\(/i]);
  const googleTagManager = hasAny(corpus, [/GTM-[A-Z0-9]+/, /googletagmanager\.com\/gtm\.js/i]);
  const searchConsole = hasAny(pageCorpus, [/name=["']google-site-verification["']/, /google-site-verification/i]);
  const nextMetadata = /export\s+(?:async\s+function\s+generateMetadata|const\s+metadata\s*=)|metadataBase\s*:|alternates\s*:/i.test(pageCorpus);
  const serverRendering = /next|nuxt|astro|sveltekit|remix|gatsby/i.test(packageJson + nextConfig) || /<html[\s>]/i.test(pageCorpus) || nextBuildFiles.length > 0;
  const disallowsAll = /User-agent:\s*\*\s*[\r\n]+Disallow:\s*\/\s*(?:\r?\n|$)/i.test(robots);
  const botMentioned = (bot: string) => new RegExp(`(?:User-agent|userAgent)\\s*[:=]\\s*['"]?${bot}`, 'i').test(robots);
  const googleMentions = GOOGLE_CRAWLERS.filter(botMentioned);
  const aiMentions = AI_CRAWLERS.filter(botMentioned);
  const aiCrawlerPolicy: SeoCrawlerReport['aiCrawlerPolicy'] = aiMentions.length >= 3 ? 'explicit' : aiMentions.length > 0 ? 'partial' : 'missing';

  const issues: SeoIssue[] = [];
  if (!robots) pushIssue(issues, 'high', 'Crawlers', 'robots.txt not found', 'Add robots.txt with Googlebot and AI crawler policy plus a Sitemap entry.');
  if (disallowsAll) pushIssue(issues, 'high', 'Crawlers', 'robots.txt blocks all crawlers', 'Confirm this is intentional; otherwise allow Googlebot and public pages.');
  if (!sitemap) pushIssue(issues, 'high', 'Google SEO', 'No sitemap detected', 'Generate sitemap.xml and reference it from robots.txt.');
  if (aiCrawlerPolicy === 'missing') pushIssue(issues, 'medium', 'AI Crawlers', 'No explicit AI crawler policy', 'Decide allow/block rules for GPTBot, ClaudeBot, PerplexityBot, CCBot, and Google-Extended.');
  if (!title) pushIssue(issues, 'medium', 'On-page SEO', 'No strong <title> or Next metadata title detected', 'Add unique titles through rendered HTML, next/head, or App Router metadata.');
  if (!metaDescription) pushIssue(issues, 'medium', 'On-page SEO', 'No useful meta description or Next metadata description detected', 'Add 40-160 character descriptions through rendered HTML or App Router metadata.');
  if (!canonical) pushIssue(issues, 'low', 'On-page SEO', 'Canonical link not detected', 'Add canonical URLs to reduce duplicate-indexing risk.');
  if (!openGraph) pushIssue(issues, 'low', 'Social Preview', 'OpenGraph tags not detected', 'Add og:title, og:description, og:image, and og:url.');
  if (!jsonLd) pushIssue(issues, 'low', 'Structured Data', 'JSON-LD schema not detected', 'Add Organization, SoftwareApplication, Product, Article, or Breadcrumb schema where relevant.');
  if (!googleAnalytics && !googleTagManager) pushIssue(issues, 'medium', 'Analytics', 'Google Analytics/Tag Manager not detected', 'Add GA4 or GTM if production traffic analytics are required.');
  if (!searchConsole) pushIssue(issues, 'low', 'Google SEO', 'Search Console verification not detected', 'Add google-site-verification metadata or document DNS verification.');
  if (!serverRendering) pushIssue(issues, 'medium', 'Rendering', 'Server-rendered/static HTML signal is weak', 'For public pages, prefer SSR/SSG or prerendering so Google and AI crawlers can reliably extract content.');

  const signals: SeoSignal[] = [
    { name: 'robots.txt', status: robots ? 'ok' : 'missing', detail: robots ? `${googleMentions.length} Google crawler rule(s), ${aiMentions.length} AI crawler rule(s)` : 'Not found' },
    { name: 'sitemap.xml', status: sitemap ? 'ok' : 'missing', detail: sitemap ? 'Sitemap detected or referenced' : 'No sitemap file/reference found' },
    { name: 'AI crawler policy', status: aiCrawlerPolicy === 'explicit' ? 'ok' : aiCrawlerPolicy === 'partial' ? 'warn' : 'missing', detail: `${aiMentions.length}/${AI_CRAWLERS.length} known AI crawlers mentioned` },
    { name: 'Google analytics', status: googleAnalytics || googleTagManager ? 'ok' : 'missing', detail: googleTagManager ? 'Google Tag Manager detected' : googleAnalytics ? 'GA4/gtag detected' : 'No GA/GTM signal' },
    { name: 'Search Console', status: searchConsole ? 'ok' : 'warn', detail: searchConsole ? 'Verification metadata detected' : 'No HTML verification signal found' },
    { name: 'Metadata', status: title && metaDescription ? 'ok' : 'warn', detail: `title=${title ? 'yes' : 'no'}, description=${metaDescription ? 'yes' : 'no'}, canonical=${canonical ? 'yes' : 'no'}` },
    { name: 'Structured data', status: jsonLd ? 'ok' : 'warn', detail: jsonLd ? 'JSON-LD detected' : 'No JSON-LD detected' },
    { name: 'Social previews', status: openGraph && twitterCard ? 'ok' : 'warn', detail: `OpenGraph=${openGraph ? 'yes' : 'no'}, Twitter card=${twitterCard ? 'yes' : 'no'}` },
    { name: 'Internationalization', status: hreflang ? 'ok' : 'warn', detail: hreflang ? 'hreflang detected' : 'No hreflang signal' },
    { name: 'Crawler rendering', status: serverRendering ? 'ok' : 'warn', detail: serverRendering ? 'SSR/SSG/static HTML signal detected' : 'CSR-only risk signal' },
    ...(isNext ? [{ name: 'Next.js build awareness', status: nextBuildFiles.length || nextMetadata ? 'ok' as const : 'warn' as const, detail: `${nextSourceFiles.length} source route file(s), ${nextBuildFiles.length} rendered build file(s), metadata=${nextMetadata ? 'yes' : 'no'}` }] : []),
  ];

  const deduction = issues.reduce((sum, issue) => sum + (issue.severity === 'high' ? 18 : issue.severity === 'medium' ? 10 : 4), 0);
  return {
    score: Math.max(0, 100 - deduction),
    filesChecked: new Set([...files, ...nextSourceFiles, ...nextBuildFiles]).size,
    robotsTxt: Boolean(robots),
    sitemap,
    googleAnalytics,
    googleTagManager,
    searchConsole,
    aiCrawlerPolicy,
    signals,
    issues: issues.slice(0, 20),
  };
}
