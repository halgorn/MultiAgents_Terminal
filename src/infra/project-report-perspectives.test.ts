import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImprovementPerspectives, WEB_TYPES } from './project-report-perspectives.js';
import type { ProjectType } from './project-identity.js';

const EMPTY_SEO = {
  score: 0,
  aiCrawlerPolicy: 'missing' as const,
  googleAnalytics: false,
  googleTagManager: false,
  robotsTxt: false,
  sitemap: false,
  canonicalTag: false,
  metaDescription: false,
  openGraph: false,
  jsonLd: false,
  hreflang: false,
  nextjsRoutes: [],
  issues: [],
};

function makeInput(projectType: ProjectType, overrides: Partial<Parameters<typeof buildImprovementPerspectives>[0]> = {}) {
  return {
    healthTotal: 75,
    cycles: 0,
    hotspots: 2,
    totalFiles: 80,
    cognitiveAvg: 18,
    apiEndpoints: 0,
    unauthenticatedApis: 0,
    unrateLimitedApis: 0,
    seo: EMPTY_SEO,
    audit: null,
    unpinnedDeps: 0,
    projectType,
    ...overrides,
  };
}

// ── WEB_TYPES ────────────────────────────────────────────────────────────────

test('WEB_TYPES includes web_app, backend_api, browser_extension', () => {
  assert.ok(WEB_TYPES.includes('web_app'));
  assert.ok(WEB_TYPES.includes('backend_api'));
  assert.ok(WEB_TYPES.includes('browser_extension'));
});

test('WEB_TYPES does not include cli_tool or multi_agent_framework', () => {
  assert.ok(!WEB_TYPES.includes('cli_tool' as ProjectType));
  assert.ok(!WEB_TYPES.includes('multi_agent_framework' as ProjectType));
});

// ── Persona count ─────────────────────────────────────────────────────────────

test('buildImprovementPerspectives returns 10 personas for web_app', () => {
  const result = buildImprovementPerspectives(makeInput('web_app'));
  assert.equal(result.length, 10);
});

test('buildImprovementPerspectives returns 10 personas for cli_tool', () => {
  const result = buildImprovementPerspectives(makeInput('cli_tool'));
  assert.equal(result.length, 10);
});

test('buildImprovementPerspectives returns 10 personas for multi_agent_framework', () => {
  const result = buildImprovementPerspectives(makeInput('multi_agent_framework'));
  assert.equal(result.length, 10);
});

// ── Web personas present for web_app ─────────────────────────────────────────

test('web_app includes SEO Engineer persona', () => {
  const result = buildImprovementPerspectives(makeInput('web_app'));
  assert.ok(result.some((p) => p.persona === 'SEO Engineer'));
});

test('web_app includes AI Crawler Policy Lead', () => {
  const result = buildImprovementPerspectives(makeInput('web_app'));
  assert.ok(result.some((p) => p.persona === 'AI Crawler Policy Lead'));
});

test('web_app includes Analytics Engineer', () => {
  const result = buildImprovementPerspectives(makeInput('web_app'));
  assert.ok(result.some((p) => p.persona === 'Analytics Engineer'));
});

// ── Web personas absent for non-web ──────────────────────────────────────────

test('cli_tool does NOT include SEO Engineer', () => {
  const result = buildImprovementPerspectives(makeInput('cli_tool'));
  assert.ok(!result.some((p) => p.persona === 'SEO Engineer'));
});

test('multi_agent_framework does NOT include AI Crawler Policy Lead', () => {
  const result = buildImprovementPerspectives(makeInput('multi_agent_framework'));
  assert.ok(!result.some((p) => p.persona === 'AI Crawler Policy Lead'));
});

// ── Non-web personas ──────────────────────────────────────────────────────────

test('multi_agent_framework uses Agent Safety Lead (not CLI UX Lead)', () => {
  const result = buildImprovementPerspectives(makeInput('multi_agent_framework'));
  assert.ok(result.some((p) => p.persona === 'Agent Safety Lead'));
  assert.ok(!result.some((p) => p.persona === 'CLI UX Lead'));
});

test('cli_tool uses CLI UX Lead (not Agent Safety Lead)', () => {
  const result = buildImprovementPerspectives(makeInput('cli_tool'));
  assert.ok(result.some((p) => p.persona === 'CLI UX Lead'));
  assert.ok(!result.some((p) => p.persona === 'Agent Safety Lead'));
});

test('cli_tool includes npm Package Lead', () => {
  const result = buildImprovementPerspectives(makeInput('cli_tool'));
  assert.ok(result.some((p) => p.persona === 'npm Package Lead'));
});

test('cli_tool includes Developer Adoption Lead', () => {
  const result = buildImprovementPerspectives(makeInput('cli_tool'));
  assert.ok(result.some((p) => p.persona === 'Developer Adoption Lead'));
});

// ── Common personas always present ────────────────────────────────────────────

test('Software Architect persona always present', () => {
  for (const type of ['web_app', 'cli_tool', 'multi_agent_framework'] as ProjectType[]) {
    const result = buildImprovementPerspectives(makeInput(type));
    assert.ok(result.some((p) => p.persona === 'Software Architect'), `missing for ${type}`);
  }
});

test('Security Engineer persona always present', () => {
  for (const type of ['web_app', 'cli_tool', 'multi_agent_framework'] as ProjectType[]) {
    const result = buildImprovementPerspectives(makeInput(type));
    assert.ok(result.some((p) => p.persona === 'Security Engineer'), `missing for ${type}`);
  }
});

test('SRE persona always present', () => {
  for (const type of ['web_app', 'cli_tool', 'multi_agent_framework'] as ProjectType[]) {
    const result = buildImprovementPerspectives(makeInput(type));
    assert.ok(result.some((p) => p.persona === 'SRE'), `missing for ${type}`);
  }
});

// ── Risk text reacts to data ──────────────────────────────────────────────────

test('SEO Engineer risk mentions score when below 70', () => {
  const result = buildImprovementPerspectives(makeInput('web_app', { seo: { ...EMPTY_SEO, score: 40 } }));
  const seo = result.find((p) => p.persona === 'SEO Engineer')!;
  assert.ok(seo.risk.toLowerCase().includes('index') || seo.risk.toLowerCase().includes('content'));
});

test('Security Engineer risk mentions criticals when present', () => {
  const result = buildImprovementPerspectives(makeInput('web_app', {
    audit: { findings: [], criticalCount: 3, highCount: 1, totalFiles: 10, summary: '', topPriorities: [] },
  }));
  const sec = result.find((p) => p.persona === 'Security Engineer')!;
  assert.ok(sec.risk.includes('3'));
});

test('npm Package Lead risk mentions unpinned count when > 0', () => {
  const result = buildImprovementPerspectives(makeInput('cli_tool', { unpinnedDeps: 5 }));
  const pkg = result.find((p) => p.persona === 'npm Package Lead')!;
  assert.ok(pkg.risk.includes('5'));
});

// ── All personas have required fields ────────────────────────────────────────

test('every persona has non-empty persona, focus, risk, recommendation, projection', () => {
  const result = buildImprovementPerspectives(makeInput('multi_agent_framework'));
  for (const p of result) {
    assert.ok(p.persona.length > 0, 'persona empty');
    assert.ok(p.focus.length > 0, 'focus empty');
    assert.ok(p.risk.length > 0, 'risk empty');
    assert.ok(p.recommendation.length > 0, 'recommendation empty');
    assert.ok(p.projection.length > 0, 'projection empty');
  }
});
