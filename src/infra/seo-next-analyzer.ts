import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative } from 'path';

export interface SeoRouteCheck {
  route: string;
  source?: string;
  rendered?: string;
  rendering: 'static' | 'ssg' | 'ssr' | 'dynamic' | 'unknown';
  title: boolean;
  description: boolean;
  canonical: boolean;
  openGraph: boolean;
  twitterCard: boolean;
  jsonLd: boolean;
  noindex: boolean;
  htmlBytes: number;
  scriptCount: number;
  textBytes: number;
  issues: string[];
}

export interface CrawlerPolicyCheck {
  crawler: string;
  status: 'allow' | 'block' | 'missing';
}

export interface NextSeoAnalysis {
  framework?: 'next';
  sourceRoutes: string[];
  buildRoutes: string[];
  manifestRoutes: string[];
  sitemapUrls: string[];
  sitemapMissingRoutes: string[];
  sitemapUnknownUrls: string[];
  crawlerPolicies: CrawlerPolicyCheck[];
  routes: SeoRouteCheck[];
}

const ROUTE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const HTML_EXTS = new Set(['.html']);
export const CRAWLERS = ['Googlebot', 'Google-Extended', 'GPTBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'PerplexityBot', 'CCBot', 'Applebot', 'Bytespider'];

function read(cwd: string, path: string): string {
  try { return readFileSync(join(cwd, path), 'utf8'); } catch { return ''; }
}

function readJson(cwd: string, path: string): Record<string, unknown> {
  try { return JSON.parse(read(cwd, path)) as Record<string, unknown>; } catch { return {}; }
}

function walk(cwd: string, roots: string[], exts: Set<string>, limit = 300): string[] {
  const out: string[] = [];
  const visit = (abs: string) => {
    if (out.length >= limit) return;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= limit) break;
      const full = join(abs, entry.name);
      if (entry.isDirectory()) { visit(full); continue; }
      if (exts.has(extname(entry.name))) out.push(relative(cwd, full));
    }
  };
  roots.forEach((root) => existsSync(join(cwd, root)) && visit(join(cwd, root)));
  return out;
}

function normalizeRoutePath(path: string): string {
  const clean = path
    .replace(/\/?(page|layout|route)$/, '')
    .replace(/\/\([^/]+\)(?=\/|$)/g, '')
    .replace(/\([^/]+\)\//g, '')
    .replace(/\[\[?\.\.\.[^/]+\]?\]/g, ':param')
    .replace(/\[[^/]+\]/g, ':param')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return clean ? (clean.startsWith('/') ? clean : `/${clean}`) : '/';
}

function appRouteFromFile(file: string): string | null {
  const clean = file.replace(/^src\//, '').replace(/^app\//, '').replace(/\.(tsx?|jsx?|mjs)$/, '');
  if (!/(^|\/)(page|layout)$/.test(clean)) return null;
  return normalizeRoutePath(clean);
}

function pagesRouteFromFile(file: string): string | null {
  const clean = file.replace(/^src\//, '').replace(/^pages\//, '').replace(/\.(tsx?|jsx?|mjs)$/, '');
  if (/^(_app|_document|_error|api\/)/.test(clean)) return null;
  return clean === 'index' ? '/' : normalizeRoutePath(clean.replace(/\/index$/, ''));
}

function routeFromHtml(file: string): string {
  const clean = file.replace(/^\.next\/server\/(app|pages)\//, '').replace(/\.html$/, '').replace(/\/index$/, '');
  return normalizeRoutePath(clean);
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter(Boolean) as string[])].sort();
}

function manifestRoutes(cwd: string): string[] {
  const routes = new Set<string>();
  for (const path of ['.next/server/app-paths-manifest.json', '.next/server/pages-manifest.json']) {
    Object.keys(readJson(cwd, path)).forEach((route) => routes.add(normalizeRoutePath(route)));
  }
  const prerender = readJson(cwd, '.next/prerender-manifest.json');
  Object.keys((prerender.routes as Record<string, unknown>) ?? {}).forEach((route) => routes.add(normalizeRoutePath(route)));
  Object.keys((prerender.dynamicRoutes as Record<string, unknown>) ?? {}).forEach((route) => routes.add(normalizeRoutePath(route)));
  return uniqueSorted([...routes]);
}

function sitemapUrls(cwd: string): string[] {
  const xml = read(cwd, 'sitemap.xml') || read(cwd, 'public/sitemap.xml') || read(cwd, '.next/server/app/sitemap.xml');
  const fromXml = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => match[1] ?? '').filter(Boolean);
  const source = read(cwd, 'app/sitemap.ts') || read(cwd, 'src/app/sitemap.ts') || read(cwd, 'app/sitemap.js') || read(cwd, 'src/app/sitemap.js');
  const fromSource = [...source.matchAll(/url\s*:\s*['"`]([^'"`]+)['"`]/gi)].map((match) => match[1] ?? '').filter(Boolean);
  return [...fromXml, ...fromSource];
}

function pathFromUrl(url: string): string {
  try { return new URL(url).pathname.replace(/\/$/, '') || '/'; } catch { return url.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/'; }
}

function relatedSourceFiles(route: string, sourceFiles: string[]): string[] {
  const routeParts = route === '/' ? [] : route.slice(1).split('/');
  return sourceFiles.filter((file) => {
    const fileRoute = appRouteFromFile(file) ?? pagesRouteFromFile(file);
    if (fileRoute === route) return true;
    if (!/(^|\/)layout\.(tsx?|jsx?|mjs)$/.test(file)) return false;
    if (!fileRoute) return false;
    if (fileRoute === '/') return true;
    const layoutParts = fileRoute.slice(1).split('/');
    return layoutParts.every((part, index) => routeParts[index] === part);
  });
}

function routeContent(cwd: string, route: string, sourceFiles: string[], htmlFiles: string[]): { source?: string; rendered?: string; sourceText: string; html: string } {
  const source = sourceFiles.find((file) => appRouteFromFile(file) === route || pagesRouteFromFile(file) === route);
  const rendered = htmlFiles.find((file) => routeFromHtml(file) === route);
  const sourceText = relatedSourceFiles(route, sourceFiles).map((file) => read(cwd, file)).join('\n');
  return { source, rendered, sourceText, html: rendered ? read(cwd, rendered) : '' };
}

function has(content: string, html: string, htmlRe: RegExp, sourceRe: RegExp): boolean {
  return htmlRe.test(html) || sourceRe.test(content);
}

function routeCheck(cwd: string, route: string, sourceFiles: string[], htmlFiles: string[], manifest: Set<string>, sitemap: Set<string>): SeoRouteCheck {
  const data = routeContent(cwd, route, sourceFiles, htmlFiles);
  const corpus = `${data.sourceText}\n${data.html}`;
  const text = data.html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const check: SeoRouteCheck = {
    route,
    source: data.source,
    rendered: data.rendered,
    rendering: data.rendered ? 'static' : manifest.has(route) ? 'ssg' : /\b(dynamic|force-dynamic|getServerSideProps)\b/.test(corpus) ? 'dynamic' : 'unknown',
    title: has(corpus, data.html, /<title\b[^>]*>[^<]{8,}<\/title>/i, /\btitle\s*:\s*['"`][^'"`]{8,}['"`]/i),
    description: has(corpus, data.html, /<meta\s+[^>]*name=["']description["'][^>]*content=["'][^"']{40,}["']/i, /\bdescription\s*:\s*['"`][^'"`]{40,}['"`]/i),
    canonical: has(corpus, data.html, /rel=["']canonical["']/i, /canonical\s*:/i),
    openGraph: has(corpus, data.html, /property=["']og:/i, /openGraph\s*:/i),
    twitterCard: has(corpus, data.html, /name=["']twitter:card["']/i, /twitter\s*:/i),
    jsonLd: /application\/ld\+json|schema\.org|JsonLd|structuredData/i.test(corpus),
    noindex: /noindex|robots\s*:\s*{[^}]*index\s*:\s*false/i.test(corpus),
    htmlBytes: Buffer.byteLength(data.html),
    scriptCount: (data.html.match(/<script\b/gi) ?? []).length,
    textBytes: Buffer.byteLength(text),
    issues: [],
  };
  if (!check.title) check.issues.push('missing title');
  if (!check.description) check.issues.push('missing description');
  if (!check.canonical) check.issues.push('missing canonical');
  if (!check.openGraph) check.issues.push('missing OpenGraph');
  if (!check.rendered && check.rendering === 'unknown') check.issues.push('no rendered HTML/manifest signal');
  if (check.htmlBytes > 0 && check.textBytes < 120) check.issues.push('thin rendered HTML');
  if (check.scriptCount > 15 && check.textBytes < 800) check.issues.push('script-heavy crawler risk');
  if (sitemap.size && !sitemap.has(route) && !route.includes(':param') && !check.noindex) check.issues.push('missing from sitemap');
  return check;
}

function crawlerPolicies(robots: string): CrawlerPolicyCheck[] {
  return CRAWLERS.map((crawler) => {
    const block = new RegExp(`(?:User-agent|userAgent)\\s*[:=]\\s*['"]?${crawler}[\\s\\S]{0,160}(?:Disallow|disallow)\\s*[:=]\\s*['"]?/`, 'i').test(robots);
    const allow = new RegExp(`(?:User-agent|userAgent)\\s*[:=]\\s*['"]?${crawler}`, 'i').test(robots);
    return { crawler, status: block ? 'block' : allow ? 'allow' : 'missing' };
  });
}

export function analyzeNextSeo(cwd: string, robots: string): NextSeoAnalysis {
  const pkg = read(cwd, 'package.json');
  const isNext = /"next"\s*:|next build|next dev/i.test(pkg) || existsSync(join(cwd, 'next.config.js')) || existsSync(join(cwd, 'next.config.mjs')) || existsSync(join(cwd, 'next.config.ts'));
  if (!isNext) return { sourceRoutes: [], buildRoutes: [], manifestRoutes: [], sitemapUrls: [], sitemapMissingRoutes: [], sitemapUnknownUrls: [], crawlerPolicies: crawlerPolicies(robots), routes: [] };
  const sourceFiles = walk(cwd, ['app', 'pages', 'src/app', 'src/pages'], ROUTE_EXTS);
  const htmlFiles = walk(cwd, ['.next/server/app', '.next/server/pages'], HTML_EXTS);
  const sourceRoutes = uniqueSorted(sourceFiles.map((file) => appRouteFromFile(file) ?? pagesRouteFromFile(file)));
  const buildRoutes = uniqueSorted(htmlFiles.map(routeFromHtml));
  const manifests = manifestRoutes(cwd);
  const urls = sitemapUrls(cwd);
  const sitemapPaths = new Set(urls.map(pathFromUrl));
  const allRoutes = uniqueSorted([...sourceRoutes, ...buildRoutes, ...manifests]);
  const routeSet = new Set(allRoutes);
  return {
    framework: 'next',
    sourceRoutes,
    buildRoutes,
    manifestRoutes: manifests,
    sitemapUrls: urls,
    sitemapMissingRoutes: allRoutes.filter((route) => !route.includes(':param') && !sitemapPaths.has(route)),
    sitemapUnknownUrls: [...sitemapPaths].filter((path) => !routeSet.has(path)),
    crawlerPolicies: crawlerPolicies(robots),
    routes: allRoutes.slice(0, 80).map((route) => routeCheck(cwd, route, sourceFiles, htmlFiles, new Set(manifests), sitemapPaths)),
  };
}
