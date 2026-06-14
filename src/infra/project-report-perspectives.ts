import type { SeoCrawlerReport } from './seo-analyzer.js';
import type { AuditReport } from '../schemas/audit.js';
import type { ProjectType } from './project-identity.js';

export interface ImprovementPerspective {
  persona: string;
  focus: string;
  risk: string;
  recommendation: string;
  projection: string;
}

export const WEB_TYPES: ProjectType[] = ['web_app', 'backend_api', 'browser_extension'];

export function buildImprovementPerspectives(input: {
  healthTotal: number;
  cycles: number;
  hotspots: number;
  totalFiles: number;
  cognitiveAvg: number;
  apiEndpoints: number;
  unauthenticatedApis: number;
  unrateLimitedApis: number;
  seo: SeoCrawlerReport;
  audit?: AuditReport | null;
  unpinnedDeps: number;
  projectType: ProjectType;
}): ImprovementPerspective[] {
  const growth = input.totalFiles > 120 ? 'as the codebase grows' : 'when the project starts scaling';
  const isWeb = WEB_TYPES.includes(input.projectType);

  const webPersonas: ImprovementPerspective[] = [
    {
      persona: 'SEO Engineer',
      focus: 'Google discoverability and public metadata',
      risk: input.seo.score < 70 ? 'Search engines may index incomplete or duplicated content.' : 'SEO baseline is acceptable, but should be monitored per release.',
      recommendation: 'Keep robots.txt, sitemap.xml, canonical tags, title, description, OpenGraph, and JSON-LD in the report checklist.',
      projection: input.seo.score < 70 ? 'Future landing pages can ship without crawlability and lose organic traffic.' : 'Future pages can be validated automatically before release.',
    },
    {
      persona: 'AI Crawler Policy Lead',
      focus: 'GPTBot, ClaudeBot, PerplexityBot, CCBot, and Google-Extended policy',
      risk: input.seo.aiCrawlerPolicy === 'missing' ? 'AI crawlers have no explicit allow/block guidance.' : 'AI crawler policy exists but should track product/legal decisions.',
      recommendation: 'Document crawler policy in robots.txt and keep it aligned with content licensing and product strategy.',
      projection: 'Without explicit policy, future content may be used or blocked inconsistently by AI search and answer engines.',
    },
    {
      persona: 'Analytics Engineer',
      focus: 'Google Analytics, Tag Manager, and Search Console instrumentation',
      risk: input.seo.googleAnalytics || input.seo.googleTagManager ? 'Analytics exists; conversion events still need validation.' : 'Production traffic may be invisible after launch.',
      recommendation: 'Add GA4/GTM, Search Console verification, conversion events, and crawler/organic dashboards.',
      projection: 'Future release impact will be hard to measure without baseline traffic and event data.',
    },
  ];

  const isAgent = input.projectType === 'multi_agent_framework' || input.projectType === 'agent_platform';
  const nonWebPersonas: ImprovementPerspective[] = [
    {
      persona: isAgent ? 'Agent Safety Lead' : 'CLI UX Lead',
      focus: isAgent
        ? 'Prompt injection, runaway agents, token explosion, and context isolation'
        : 'Terminal UX, onboarding, error messages, and interactive flows',
      risk: isAgent
        ? 'Agent outputs used as inputs without sanitization can cause recursive execution or context explosion.'
        : input.healthTotal < 70
          ? 'Poor CLI UX increases support overhead and reduces adoption.'
          : 'Help text and error messages should be reviewed with new users.',
      recommendation: isAgent
        ? 'Audit agent-to-agent data flows for prompt injection. Add max-token guards, depth limits, and output sanitization before re-ingestion.'
        : 'Ensure every error exits with a meaningful message and non-zero code. Add --help examples and an onboarding command (e.g., init).',
      projection: isAgent
        ? `${growth}, agent chains can amplify a single injection into a full context takeover.`
        : 'Poor first-run experience is the leading cause of CLI tool abandonment.',
    },
    {
      persona: 'npm Package Lead',
      focus: 'Package integrity, bundle size, unpinned deps, and publish workflow',
      risk: input.unpinnedDeps > 0
        ? `${input.unpinnedDeps} unpinned dependency(s) create supply-chain drift risk between installs.`
        : 'Package is well-pinned; ensure publish workflow includes a size check.',
      recommendation: 'Pin all runtime deps to exact versions. Add a pre-publish size guard. Deprecate broken releases immediately.',
      projection: `${growth}, unpinned deps cause silent breakage when upstream packages release breaking changes.`,
    },
    {
      persona: 'Developer Adoption Lead',
      focus: 'npm downloads, README quality, changelog, and first-run experience',
      risk: 'Without telemetry or download tracking, it is hard to know which commands are used most or where new users get stuck.',
      recommendation: 'Add a CHANGELOG, keep README examples current, and consider opt-in anonymous usage telemetry for prioritization.',
      projection: 'Tools with clear changelogs and accurate README examples retain contributors and users at higher rates.',
    },
  ];

  const leadingPersonas = isWeb ? webPersonas : nonWebPersonas;

  return [
    ...leadingPersonas,
    {
      persona: 'Performance Engineer',
      focus: 'Rendering, bundle size, API latency, and crawler-friendly pages',
      risk: input.apiEndpoints > 0 && input.unrateLimitedApis > 0 ? `${input.unrateLimitedApis} API endpoint(s) show no rate-limit signal.` : 'Performance risk is mostly architectural and should be tracked with synthetic checks.',
      recommendation: 'Add route-level latency budgets, cache strategy, rate limits, and SSR/SSG checks for public pages.',
      projection: `${growth}, unbounded APIs and client-only rendering can increase latency and reduce crawler extraction quality.`,
    },
    {
      persona: 'Database Architect',
      focus: 'Data model, query growth, indexes, and API-to-DB pressure',
      risk: input.apiEndpoints > 0 ? 'API growth can create hidden N+1 queries, missing indexes, and transactional coupling.' : 'Database risk is unknown because no API surface was detected.',
      recommendation: 'Map each API/domain module to tables, expected cardinality, indexes, read/write paths, and slow-query budgets.',
      projection: 'At higher traffic, missing indexes and unclear ownership boundaries usually become latency spikes and migration risk.',
    },
    {
      persona: 'Software Architect',
      focus: 'Coupling, module boundaries, and graph health',
      risk: input.cycles > 0 ? `${input.cycles} dependency cycle(s) can block refactors.` : `${input.hotspots} hotspot module(s) should be watched.`,
      recommendation: 'Use the architecture graph to define module boundaries and reduce hotspot fan-in/fan-out before adding major features.',
      projection: 'If central modules keep absorbing responsibilities, future changes will require broader regression testing.',
    },
    {
      persona: 'Security Engineer',
      focus: 'Authentication, authorization, supply chain, and exposed metadata',
      risk: input.audit?.criticalCount || input.audit?.highCount ? `${input.audit.criticalCount} critical and ${input.audit.highCount} high audit finding(s) remain.` : 'No high-severity audit signal in the latest report.',
      recommendation: 'Keep local secrets/SBOM scans zero-token and run focused AI audits only for high-risk domains.',
      projection: 'Unpinned dependencies and unauthenticated endpoints become higher-impact as deployment surface grows.',
    },
    {
      persona: 'SRE',
      focus: 'Observability, reliability, and future incident detection',
      risk: input.healthTotal < 70 ? `Health score ${input.healthTotal}/100 indicates operational fragility.` : 'Health score is acceptable, but trend data should be monitored.',
      recommendation: 'Add health trend gates, error budgets, logs/traces coverage, and release dashboards.',
      projection: 'Without trend history, regressions in churn, bus factor, and maintainability will appear late.',
    },
    {
      persona: 'QA Lead',
      focus: 'Coverage, regression risk, and generated-file noise',
      risk: input.cognitiveAvg > 25 ? `Average cognitive score ${input.cognitiveAvg} suggests harder test design.` : 'Complexity is manageable but should be tracked per hotspot.',
      recommendation: 'Prioritize tests around hotspots, high-churn files, and public API/database boundaries.',
      projection: 'As complexity grows, low coverage around central modules will turn small changes into broad regressions.',
    },
    {
      persona: 'Developer Experience Lead',
      focus: 'Actionability, onboarding, and report signal quality',
      risk: input.unpinnedDeps > 0 ? `${input.unpinnedDeps} unpinned dependency signal(s) can distract or create supply-chain drift.` : 'Report noise is lower after excluding generated artifacts.',
      recommendation: 'Keep generated/build artifacts excluded, add suppressions for accepted risks, and make each report section actionable.',
      projection: 'Cleaner reports reduce triage time and make the tool easier for other devs to adopt in daily workflows.',
    },
  ];
}
