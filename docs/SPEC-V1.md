# Aion v1.0 SPEC

> The project gateway for code-aware AI agents.

**Replaces:** `ROADMAP.md` (deprecated — see Deprecation Plan §6).
**Audience:** Maintainers + contributors.
**Status:** Draft for execution.
**Last updated:** 2026-06-27.
**Source:** 10-persona audit (Jun 2026) — see `docs/adr/` for prior ADRs.

---

## 1. Context

Aion today is a 36-command CLI + MCP server positioned as "multi-agent AI engineering runtime." The 10-persona audit revealed:

- The real moat is the **Project Intelligence Layer (PIL)** + **freshness-aware MCP** — not the audit features.
- 5 parallel vector stores, 60% pipeline boilerplate, dual binary, 91/193 untested files.
- 5 P0 security issues; OSS readiness 3.5/10.
- Position competes with 50 audit tools when the right category is **gateway** (Headroom/Portkey pattern).

This spec replaces the ad-hoc `ROADMAP.md` with a **sector-driven execution plan**: 10 streams, dependency-ordered, each with deliverables, acceptance criteria, and effort estimate.

---

## 2. North Star

**Tagline:** "The project gateway for code-aware AI agents — cuts tokens, kills hallucinations, sits between your IDE and your codebase."

**One-sentence positioning:** Aion is the gateway between any LLM agent (Cursor, Claude Code, Codex, OpenCode) and your codebase — compresses context, validates freshness, routes to the cheapest backend that answers correctly.

**Ideal user:** Engineering leads at 5-50 person AI-native teams burning $1-10k/mo on agent tokens; platform engineers integrating MCP servers into their LLM stacks.

---

## 3. Goals / Non-Goals

### Goals (v1.0)
- 8 commands (down from 36)
- 1 PIL, 1 vector store, 1 schema registry, 1 FlowBuilder
- MCP v3 contract: versioned URIs, complete `_meta`, error codes
- 5 P0 security issues closed
- ≥80% test coverage per dir
- 4 distribution channels: npm + npx + Docker + GitHub Action + MCP registry
- LICENSE + CONTRIBUTING + SECURITY + CHANGELOG + CODE_OF_CONDUCT
- Tagline + logo + landing page

### Non-Goals (v1.0)
- Cloud hosted version (v1.x)
- SaaS pricing model (v1.x)
- Database/network analyzers from old ROADMAP (deferred to plugins)
- `assist` / `cloud` / `deploy` / `deepeval` commands (cut)
- LangGraph as primary orchestrator (kept as opt-in behind `AION_ORCHESTRATOR=langgraph`)
- Real-time collaboration / web UI / VSCode extension

---

## 4. Sectors (10 streams, dependency-ordered)

### Sector 0 — Repository Hygiene

**Goal:** Make the repo clean, professional, and discoverable.
**Effort:** 1-2 days · **Blocks:** All other sectors (clean baseline).

**Deliverables:**
- [ ] Create `LICENSE` (MIT full text)
- [ ] Create `CONTRIBUTING.md` (setup, `npm link`, PR template, claim spec section, commit msg convention)
- [ ] Create `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1)
- [ ] Create `SECURITY.md` (disclosure policy, supported versions, `security@` contact)
- [ ] Create `CHANGELOG.md` (Keep-a-Changelog, retroactive entries for v0.6.6)
- [ ] Create `AUTHORS.md`
- [ ] Create `.github/dependabot.yml` (16 deps tracked)
- [ ] Create `.github/PULL_REQUEST_TEMPLATE.md`
- [ ] Create `.github/ISSUE_TEMPLATE/{bug,feature,question}.md`
- [ ] Create `.eslintrc.json` + `.prettierrc` + `.editorconfig`
- [ ] Create `examples/` with 3 starters: `node-consumer/`, `mcp-client/`, `github-action/`
- [ ] Add `assets/logo.svg` + `assets/favicon.svg` + `assets/social-card.png`
- [ ] Add `npm run lint`, `npm run format`, `npm run typecheck` scripts
- [ ] Add `npm run test:contract`, `npm run test:integration` scripts
- [ ] **DELETE** `ROADMAP.md` (replaced by this spec)
- [ ] **DELETE** orphan `src/cli/commands/scan-seo.ts` (never registered in `src/index.ts`)
- [ ] **CLEAN** `package.json:16` `smoke:manus` script referencing private path `/home/bruno/Documents/GitHub/Manus_Private`
- [ ] **UPDATE** `.gitignore` for new dirs (`.ai-runtime/`, `.claude/`, `assets/build/`, `coverage/`)

**Acceptance:**
- Repo passes `npm run lint && npm run typecheck && npm run test` clean
- All 4 community-standard files present at root
- `ROADMAP.md` removed; `docs/SPEC-V1.md` (this file) is the canonical roadmap
- Zero references to private paths in tracked files

**Files touched:** Root (12 new files, 1 delete), `.github/` (4 new), `package.json` scripts.

---

### Sector 1 — Security P0

**Goal:** Close 5 critical security issues before any release.
**Effort:** 3-5 days · **Blocks:** Sector 4 (MCP handlers must be safe), Sector 7 (Distribution).

**Deliverables:**
- [ ] **S1.1 MCP path traversal** — `path.resolve` + prefix check on every `cwd`/`file` arg in `src/mcp/server.ts:40,64-122` and `src/mcp/resources.ts:182-252`. Extract `assertWithinBase(resolved, base): void` helper that throws typed error.
- [ ] **S1.2 Postinstall RCE** — Replace `package.json:23` postinstall with self-skip-only: `node -e "if(require('./package.json').name!=='@aionlabsai/aion')process.exit(0)"`. Delete the `init` auto-run.
- [ ] **S1.3 `.env` in vectors** — Global secret exclude list at root of all walkers: `src/infra/repo-index.ts`, `src/infra/chunker.ts`, `src/infra/security-scanner.ts:27-43`. List: `.env`, `.env.*`, `id_rsa`, `id_ed25519`, `.npmrc`, `.netrc`, `*.pem`, `*.key`, `*.p12`.
- [ ] **S1.4 Webhook SSRF** — In `src/cli/commands/audit.ts:318-334`: validate URL is `https?`, reject RFC1918/loopback/link-local. Strip `reportHtml` from payload.
- [ ] **S1.5 Prompt injection** — In `src/agents/{investigator,planner,developer}.ts` and `src/prompts/scanner.ts`: wrap all user-controlled/file-derived content in `<untrusted>...</untrusted>` fences in user messages. In `src/providers/sdk-provider.ts:38-53` and `src/providers/sse-completion.ts:27-34`: force `response_format: json_schema` on all non-prompt LLM calls (when supported by provider).
- [ ] **S1.6 Output validation** — Every `parseJson` call site validates against the Zod schema declared in `ZOD_SCHEMA_REGISTRY`. Reject mismatches before next agent sees the data.
- [ ] **S1.7 Security tests** — `src/security/security-p0.test.ts`: path traversal attempts (5 vectors), secret-in-vector test, webhook URL bypass tests, prompt injection regression suite (curated 5-case library), Zod validation enforcement.

**Acceptance:**
- Manual exploit attempt against each of 5 issues fails
- `src/security/security-p0.test.ts` passes
- No `.env*` content in `aion search --semantic` results (verified via test fixture)
- All Anthropic/OpenRouter calls use `response_format: json_schema` where supported

**Files touched:** `package.json:23`, `src/mcp/{server,resources}.ts`, `src/infra/{repo-index,chunker,security-scanner}.ts`, `src/cli/commands/audit.ts`, `src/agents/{investigator,planner,developer}.ts`, `src/providers/{sdk-provider,sse-completion}.ts`, `src/security/*`. ~17 files.

---

### Sector 2 — Architecture & Layering

**Goal:** Establish clean architecture with one-direction dependencies.
**Effort:** 1 week · **Blocks:** Sectors 3, 4, 5 (need layer boundaries before refactor).

**Deliverables:**
- [ ] **S2.1 Move domains** — `src/schemas/*.ts` → `src/domain/{audit,task,flows}/`. `src/schemas/registry.ts` → `src/domain/registry.ts`.
- [ ] **S2.2 Move agents** — `src/agents/*.ts` → `src/application/agents/`. `src/agents/index.ts` → `src/application/agents/registry.ts`.
- [ ] **S2.3 Move prompts** — `src/prompts/*.ts` → `src/infrastructure/llm/prompts/`.
- [ ] **S2.4 Move providers** — `src/providers/*.ts` → `src/infrastructure/llm/providers/`.
- [ ] **S2.5 Move core** — `src/core/{state-machine,task,runtime-policy,pipeline-context,cost-tracker}.ts` → `src/application/runtime/`. `src/core/orchestrator.ts` → `src/application/runtime/orchestrator.ts`. `src/core/langgraph-orchestrator.ts` → `src/application/runtime/langgraph-adapter.ts`.
- [ ] **S2.6 Move pipelines** — `src/core/pipelines/*-pipeline.ts` → `src/application/flows/*-flow.ts`. `src/core/pipelines/audit-file-scanner.ts` → `src/infrastructure/scanners/workspace-scanner.ts`.
- [ ] **S2.7 Move mcp** — `src/mcp/*` → `src/interface/mcp/*` (one-to-one).
- [ ] **S2.8 Move cli** — `src/cli/*` → `src/interface/cli/*` (preserve `ui/`).
- [ ] **S2.9 Split infra** — `src/infra/*` → `src/infrastructure/{persistence,scanners,rag,observability,workspace,assist}/` (one-to-one renames).
- [ ] **S2.10 Update imports** — Codemod all `import` paths via jscodeshift or sed-based script. Add `tsconfig.json` `paths` aliases for cross-layer references.
- [ ] **S2.11 Layer rule enforcement** — `scripts/check-layers.mjs`: fails CI if `interface/` imports `infrastructure/` directly, or `domain/` has any imports. Runs in `npm run lint`.

**Acceptance:**
- `tsc --noEmit` passes with zero errors after move
- All existing tests pass without modification
- `scripts/check-layers.mjs` passes (no reverse arrows)
- Diff size: ~190 file renames, ~500 import updates
- New directory tree matches §4 of `docs/ARCHITECTURE.md` (which may also need updating)

**Files touched:** All TS files in `src/`. No behavior change.

---

### Sector 3 — Unified Schemas & Registry

**Goal:** One source of truth for types, schemas, manifests.
**Effort:** 3-5 days · **Depends on:** Sector 2.

**Deliverables:**
- [ ] **S3.1 Generic `ManifestRegistry<T>`** — `src/domain/registry.ts`: `register(name, manifest)`, `get(name)`, `all()`. Agents, flows, schemas, tools, prompts all register here.
- [ ] **S3.2 Merge Finding schemas** — `AuditFindingSchema` (`src/schemas/audit.ts:10`) ∪ `ReviewFindingSchema` (`src/schemas/review.ts:3`) → single `FindingSchema` in `src/domain/audit/types.ts`. Update `src/agents/{synthesizer,reviewer}.ts`.
- [ ] **S3.3 Merge Domain enums** — `InvestigatorDomain` (`src/prompts/investigator.ts:1`) ∪ `ScanDomain` (`src/prompts/scanner.ts:1`) → single `Domain` union in `src/domain/audit/types.ts`. Update both prompt files + `src/schemas/plan.ts:7`.
- [ ] **S3.4 Delete `KNOWN_OUTPUT_SCHEMAS`** — Replace with strict Zod validation in `src/agents/base-agent.ts` `parseJson`.
- [ ] **S3.5 Prompt template** — `src/infrastructure/llm/prompts/template.ts` exports `buildAgentPrompt({ role, allowedTools, constraints, steps, outputJson, extras? })`. Uses `z.toJSONSchema()` so prompt + schema can't drift.
- [ ] **S3.6 Migrate all prompts** — Rewrite 8 prompt files to use template. Verify schema-prompt parity via `src/schemas/contracts.test.ts`.
- [ ] **S3.7 Expand contract tests** — `src/schemas/contracts.test.ts` asserts: every registered agent has a prompt + schema; every flow's steps reference registered agents; every output schema parses sample data.

**Acceptance:**
- One registry, one Finding, one Domain
- Zero copy-paste between schemas and prompts
- `npm run test:contract` green
- Changing a Zod schema auto-propagates to prompt JSON shape

**Files touched:** `src/domain/registry.ts` (rewrite), `src/domain/audit/types.ts`, `src/infrastructure/llm/prompts/{template,8 files}.ts`, `src/agents/base-agent.ts`, `src/schemas/contracts.test.ts`. ~15 files.

---

### Sector 4 — MCP v3 Contract

**Goal:** Stable, versioned MCP surface that delivers the gateway promise.
**Effort:** 1 week · **Depends on:** Sectors 1 (security), 2 (layering).

**Deliverables:**
- [ ] **S4.1 Versioned URIs** — All resources migrate to `aion://v3/...`. `src/mcp/resources.ts:21-178` updated. Legacy `aion://...` returns redirect hint in error message.
- [ ] **S4.2 Complete `_meta`** — `src/mcp/freshness.ts:50-72` computes real `filesChangedSince` (not 0) by reading `src/mcp/watcher.ts:45`. Every tool/resource/prompt response carries full `McpResponseMeta`.
- [ ] **S4.3 Prompts carry `_meta`** — `src/mcp/server.ts:244-251` `GetPromptRequestSchema` handler returns messages + `_meta` (mirrors resources/tools).
- [ ] **S4.4 Error codes** — `src/mcp/types.ts` adds `AionErrorCode` enum (`AION_PIL_MISSING`, `AION_PIL_STALE`, `AION_EMBEDDING_UNAVAILABLE`, `AION_MODULE_NOT_FOUND`, `AION_RATE_LIMIT`, `AION_INTERNAL`). Handlers return `CallToolResult.isError: true` + `_meta.error.{code,message,retryable}` instead of plain text errors in `src/mcp/{server.ts:43-62,resources.ts:184,199,254,354}`.
- [ ] **S4.5 Resource templates** — Use MCP `ListResourceTemplatesRequestSchema` (currently absent). `aion://v3/modules/{name}` and `aion://v3/files/{path}` declared as proper `ResourceTemplate` with `?from=&to=` cursor support.
- [ ] **S4.6 Output schemas** — Every tool declares `outputSchema` (currently missing). `search_memory` returns `{results, meta}` strictly typed.
- [ ] **S4.7 Notifications** — Fix `notifications/resources/updated` to include only changed URIs (`src/mcp/server.ts:280-285,332-334` currently hardcodes 3-5). Add `notifications/tools/list_changed`. Add `notifications/progress` for long sync (token in `_meta.progressToken`).
- [ ] **S4.8 Pagination** — Cursor-based on `aion://v3/observability/recent?cursor=`, `aion://v3/docs/test-coverage?cursor=`, `aion://v3/files/{path}?from=&to=`, `search_memory` tool.
- [ ] **S4.9 MCP stdio integration test** — `src/__integration__/mcp-stdio.test.ts` spawns server as child, sends JSON-RPC `initialize`/`tools/list`/`tools/call` over stdio, asserts shape + error codes roundtrip.
- [ ] **S4.10 Doc sync** — `docs/mcp-contract.md` (new) is authoritative spec. `docs/mcp.md` and `docs/mcp-options.md` either point to it or get rewritten to match (current drift: README says "11 resources", code has 12; version mismatch 0.7.0 vs 0.6.6; `mcp-options.md` lists fictional `aion://prompt/...` URIs that don't exist).

**Acceptance:**
- `aion mcp serve` exposes only `aion://v3/*` URIs
- Every response has `_meta` with `filesChangedSince` matching watcher state
- Error responses use error codes, not strings
- MCP stdio integration test passes
- `docs/mcp-contract.md` matches code (CI gate: `npm run test:doc-drift`)

**Files touched:** `src/mcp/{server,resources,prompts,types,freshness,watcher,observability}.ts`, `docs/mcp-contract.md` (new), `docs/mcp.md`, `docs/mcp-options.md`. ~10 files.

---

### Sector 5 — Agent Runtime (FlowBuilder + Provider abstraction)

**Goal:** Declarative pipelines; clean provider boundary.
**Effort:** 1 week · **Depends on:** Sector 3.

**Deliverables:**
- [ ] **S5.1 FlowBuilder** — `src/application/flows/builder.ts` exports `flow(name).step(agent, fn).fanOut(agents, fn).review(agent).onFailure(strategy, fn).build()`. Encodes state machine declaratively; replaces inline `transition(task, 'FAILED', ...)` patterns.
- [ ] **S5.2 Rewrite 5 flows** — `audit-flow`, `fix-flow`, `analyze-flow`, `review-flow`, `audit-fix-flow` as `FlowBuilder` declarations. Delete `src/application/flows/analyze-flow.ts:13` cross-import — move `pickInvestigatorDomains`, `mergeEvidence` to `src/application/flows/shared.ts`.
- [ ] **S5.3 `ProviderCapabilities`** — `src/infrastructure/llm/providers/types.ts` adds `interface ProviderCapabilities { hasToolAccess(): boolean; runWithFiles(input, files): Promise<RunOutput> }`. `CLI_PROVIDERS` constant moves from `src/agents/scanner.ts:34` to provider module, queried by capability not name.
- [ ] **S5.4 Unified provider usage** — `src/agents/scanner.ts:33-48` file-embedding logic moves to `cli-provider.runWithFiles`. Prompts stop listing tool names duplicated with `src/providers/cli-provider.ts:19-27` `AGENT_TOOLS` map.
- [ ] **S5.5 `RuntimePolicy` expansion** — Add `qaProvider`, `synthesizerProvider`, `claudeHttpModel`. Normalize to `models: Record<ProviderName, string>`. `src/agents/qa.ts:19` `provider: 'codex'` becomes `policy.qaProvider`.
- [ ] **S5.6 `TokenUsage` event** — `src/application/runtime/pipeline-context.ts` emits typed `TokenUsage` event. Providers stop using `\0tokens:...\0` / `\0usage-unavailable\0` strings; `CostTracker` consumes the event.
- [ ] **S5.7 Remove LangGraph passthrough** — Either delete `src/application/runtime/langgraph-adapter.ts` or make it the only path (no env-gated branch in `src/core/langgraph-orchestrator.ts:13-15`).
- [ ] **S5.8 Slim Orchestrator** — `src/application/runtime/orchestrator.ts` becomes `FlowContext` decorator. `Trace`/`Cost` responsibilities move to `TraceSink`/`CostSink` adapters in `src/infrastructure/observability/`.

**Acceptance:**
- Adding a new pipeline = 1 file, ~30 lines, declarative
- Adding a new provider = 1 file, no edits in agents or prompts
- Token usage reported uniformly across all providers
- All 5 flows share same lifecycle (create task, transition, save, error)

**Files touched:** `src/application/flows/{builder,5 flows,shared}.ts`, `src/infrastructure/llm/providers/{types,cli,sdk,openrouter,kimi,minimax}.ts`, `src/application/runtime/{pipeline-context,orchestrator,cost-tracker}.ts`. ~20 files.

---

### Sector 6 — Command Surface (36 → 8)

**Goal:** One command per intent; deprecate the rest gracefully.
**Effort:** 1 week · **Depends on:** Sector 5.

**Deliverables:**
- [ ] **S6.1 Implement 8 commands** — `init`, `sync`, `mcp`, `wiki`, `find`, `chat`, `doctor`, `next`. Each thin wrapper around use cases.
- [ ] **S6.2 Sub-command structure** — `mcp install|serve|doctor|logs`. `find --mode=symbol|semantic|hotspots|churn`. `chat history|clear`. `doctor --scope=project|mcp|all`.
- [ ] **S6.3 Universal `--json`** — All 8 commands accept `--json`. CI scripts depend on it.
- [ ] **S6.4 Deprecation banners** — All 28 removed commands print on first use: `⚠ 'aion <cmd>' is deprecated, use 'aion <new>'. Removal in v1.2.`. Logged once per session via `src/cli/cli-utils.ts`.
- [ ] **S6.5 Compatibility window** — 2 minor releases (v1.0, v1.1) keep removed commands as deprecation shims that delegate to new command. v1.2 deletes them.
- [ ] **S6.6 Single binary** — Remove `ai-runtime` alias from `package.json:7`. Keep `aion` only. Print warning on `ai-runtime` use for 2 releases.
- [ ] **S6.7 `aion --tldr`** — New flag showing 8 commands grouped by intent (non-TTY default; CI-friendly).
- [ ] **S6.8 Menu redesign** — `src/interface/cli/menu-items.ts` becomes 8 numbered items + footer status bar (provider, project, `aion doctor` summary) + `?` help. Two-column layout on terminals ≥90 cols preserved.
- [ ] **S6.9 Onboarding wizard** — `aion init` becomes single 3-step wizard (provider pick, scope, goal). Bare `aion` opens it if `.aionrc.json` missing.

**Acceptance:**
- `aion --help` lists exactly 8 commands + global flags
- All 28 old commands print deprecation banner and delegate correctly
- `aion --tldr` works without TTY
- New user reaches first scan in <60s via `aion init` → `aion next`

**Files touched:** `src/interface/cli/commands/{8 rewrites, 28 shim/keep decisions}.ts`, `package.json:7` (bin), `src/interface/cli/menu-items.ts`, `src/interface/cli/cli-utils.ts`. ~36 files.

---

### Sector 7 — RAG v2 (unified PIL)

**Goal:** One vector store, one schema, incremental sync.
**Effort:** 1.5 weeks · **Depends on:** Sector 2.

**Deliverables:**
- [ ] **S7.1 PIL layout** — `src/infrastructure/rag/` new module. `.ai-runtime/pil/{manifest.json,files.bin,chunks.bin,symbols.bin,deps.bin,bm25.bin,vectors.bin,hashes.json}` layout.
- [ ] **S7.2 `EmbeddingRegistry`** — `src/infrastructure/rag/embeddings/registry.ts` with `voyageCode3`, `openaiTextEmbedding3Small`, `xenovaJinaCode`, `ollamaNomic`, `hashFallback`. Resolution: `.aionrc.json` → env var → first configured.
- [ ] **S7.3 `ChunkerRegistry`** — `src/infrastructure/rag/chunkers/registry.ts`. Tree-sitter multi-lang (TS, JS, Py, Go, Rust, Java, Ruby, Kotlin, C#). Fallback to line-based for unknown.
- [ ] **S7.4 `VectorIndex` interface** — `flat | ivf | hnsw`. Default flat for v1.0.
- [ ] **S7.5 `SyncEngine`** — Streaming async iterable, `onlyChanged` mode reads `hashes.json` + mtime, re-chunks/embeds only changed files. AbortSignal-aware.
- [ ] **S7.6 `SchemaMigrator`** — `v0→v1` (legacy `repo-index.json`) and `v1→v2` (PIL). Idempotent. Writes `.migrated.vN` marker.
- [ ] **S7.7 Dual-write v1.0** — When `AION_PIL_V2=1` env or v2 is default, write v2 + legacy v1. Read v2 if present, fall back to v1.
- [ ] **S7.8 Unified `query()`** — `src/infrastructure/rag/query.ts` exports `query(pil, {mode, topK, filters, reranker})`. Hybrid BM25+vector via RRF. Single path consumed by `search`, `chat`, MCP `search_memory`, `wiki`.
- [ ] **S7.9 Update consumers** — `src/interface/cli/commands/{search,chat}.ts`, `src/interface/mcp/server.ts:39` `handleSearchMemory`, `src/interface/cli/commands/wiki.ts:106`. All read from `PilReader`. Delete `repo-vectors.ts`, `vector-store.ts`, `bm25.ts`, `knowledge.ts`, `knowledge-factory.ts`, `embeddings.ts` writer functions. Legacy files become read-only migration inputs.
- [ ] **S7.10 MCP contract preservation** — Verify `aion://v3/*` URIs + `_meta` shape unchanged. Smoke test with Cursor + Claude Code + Codex + OpenCode against fresh project.

**Acceptance:**
- One PIL per project, one vector index, one chunker registry
- `aion sync --incremental` on 10k file repo with 5 changed files = <2s
- Switching embedding provider invalidates cache correctly (no mixed-dim vectors)
- MCP clients see no contract change
- `hashes.json` + `bm25.bin` + `vectors.bin` is the single state

**Files touched:** `src/infrastructure/rag/*` (new), `src/interface/mcp/server.ts`, `src/interface/cli/commands/{search,chat,wiki,sync,memory}.ts`. Delete 6 legacy files. ~20 files.

---

### Sector 8 — Performance

**Goal:** Real parallelism; real incremental sync.
**Effort:** 3-5 days · **Depends on:** Sectors 5 (FlowBuilder enables parallelism), 7 (PIL enables incremental).

**Deliverables:**
- [ ] **S8.1 Parallelize scanners** — Replace `runSequential` in `src/core/pipelines/audit-pipeline.ts:322` with bounded `Promise.all` (concurrency = `min(domains.length, 3)`). Inline p-limit-style helper (avoid new dep).
- [ ] **S8.2 Cache dep-graph** — Write `dep-graph.json` keyed by `repoHash` (already in PIL). Skip rebuild when hash matches. Applies to `aion audit` and MCP `get_dep_graph` (`src/mcp/server.ts:64`).
- [ ] **S8.3 Parallelize `buildScannerContext`** — Wrap 4 sequential I/O blocks (`src/core/pipelines/audit-pipeline.ts:65-117`) in `Promise.all`.
- [ ] **S8.4 Worker pool for tree-sitter** — `worker_threads` for `chunkFile` in `src/infra/repo-index.ts:256-278`. Pool size = `os.cpus().length - 1`.
- [ ] **S8.5 Stream FS walks** — `collectAuditStats` in `audit-file-scanner.ts:53-83` uses `readdirSync({withFileTypes:true, recursive:true})` (Node 20+).
- [ ] **S8.6 LRU cache for KnowledgeStore** — `JsonFileStore.search` + `KnowledgeStore.query` get in-process LRU keyed by query string. TTL 60s.
- [ ] **S8.7 Performance benchmarks** — `src/__bench__/*.bench.ts` with `aion sync` and `aion audit` on a 10k-file fixture. Assert wallclock budgets (sync <10s, audit <2min cold). Run in CI nightly, not on PR.

**Acceptance:**
- 10k-file repo: sync 6-10s, audit 2-7min cold
- Benchmarks added to CI as regression gate (nightly)
- Scanners actually run in parallel (proven by overlapping timestamps in logs)

**Files touched:** `src/application/flows/audit-flow.ts`, `src/infrastructure/{scanners/workspace-scanner,rag/index}.ts`, `src/application/runtime/pipeline-context.ts`. ~8 files.

---

### Sector 9 — Testing & CI

**Goal:** ≥80% coverage with contract + integration tests; CI as gate.
**Effort:** 1 week (parallel with implementation) · **Depends on:** All other sectors (tests for new code).

**Deliverables:**
- [ ] **S9.1 Coverage tool** — Add `c8` to devDeps. `npm run test:coverage` script. Reports per-dir.
- [ ] **S9.2 Contract test expansion** — `src/schemas/contracts.test.ts` covers all 5 registries + cross-references. New: every registered tool has prompt + schema; every flow's steps reference registered agents.
- [ ] **S9.3 MCP stdio integration** — `src/__integration__/mcp-stdio.test.ts` (Sector 4.9). JSON-RPC 2.0 roundtrip with real stdio transport.
- [ ] **S9.4 CLI integration** — `src/__integration__/cli/*.test.ts` spawns `tsx src/index.ts` against tmp repos for each of the 8 commands. Asserts exit codes + JSON output shape.
- [ ] **S9.5 Renderer snapshots** — Snapshot tests for `audit-report-{html,html-dashboard,css,writer}.ts` golden output. Assert XSS escaping on file/finding fields.
- [ ] **S9.6 Pipeline tests** — One test per `FlowBuilder` declaration: audit, fix, analyze, review, audit-fix. Mock provider, assert phase order, failure strategy propagation.
- [ ] **S9.7 RAG tests** — `query()` correctness on fixture: hybrid > vector alone > bm25 alone on curated queries. Schema migration roundtrip v0→v1→v2.
- [ ] **S9.8 CI workflow** — `.github/workflows/ci.yml`: typecheck → lint → contract → unit → integration → doc-drift. Block PR if any fails.
- [ ] **S9.9 Lint workflow** — `.github/workflows/lint.yml`: eslint + prettier check.
- [ ] **S9.10 Coverage gate** — `coverage` job in CI fails if any dir drops below 80% line coverage.
- [ ] **S9.11 CodeQL** — `.github/workflows/codeql.yml` for security scanning.

**Acceptance:**
- `npm run test:ci` = typecheck + lint + contract + unit + integration green
- Coverage report shows ≥80% per sector
- PR merge blocked if any CI check fails
- MCP server tested via real stdio transport (not mocked)

**Files touched:** `.github/workflows/{ci,lint,codeql}.yml`, `package.json` scripts, `src/__integration__/**`, `src/__bench__/**`. ~15 files.

---

### Sector 10 — Distribution & Branding

**Goal:** 4 channels; clear brand; landing page.
**Effort:** 1 week · **Depends on:** Sectors 6, 9.

**Deliverables:**
- [ ] **S10.1 README rewrite** — Hero section with badges (npm, license, CI, Node 18+, downloads) + tagline + demo GIF. "Why Aion?" 3-bullet value prop. 5-step Quick Start (MCP-first). Comparison table vs Cursor/Cline/Aider/Snyk. Library API section. Contributing section. License section. 200-300 lines max.
- [ ] **S10.2 npx verification** — `npx @aionlabsai/aion init` works without global install. Add to README Quick Start.
- [ ] **S10.3 Dockerfile** — Multi-stage: `node:20-alpine` builder → `node:20-alpine` runtime, non-root user. `docker run aionlabs/aion audit .`. Publish to Docker Hub.
- [ ] **S10.4 GitHub Action** — `.github/action.yml` (composite) for `uses: aionlabs/aion-action@v0`. Self-test: action in this repo's CI runs `aion audit .` on PR diff.
- [ ] **S10.5 MCP registry entry** — Register on `modelcontextprotocol/registry`. Server config + capabilities + transport (stdio).
- [ ] **S10.6 Logo + assets** — `assets/logo.svg` + `assets/favicon.svg` + `assets/social-card.png` (1200×630). Greek Α stylized as `Α>` prompt. Single accent color.
- [ ] **S10.7 Landing page** — `docs/site/` VitePress or minimal Astro site. One-page: hero + install + comparison + getting started + contributors. Deploy to GitHub Pages via `.github/workflows/pages.yml`.
- [ ] **S10.8 Brand colors** — Single accent (suggested: deep graphite `#0B0E14` bg + cyan-mint `#5EEAD4` accent). Apply to CLI (`chalk`) + landing + docs.
- [ ] **S10.9 Update `package.json` metadata** — `description`, `keywords` (drop stuffing), `homepage`, `repository`, `bugs`. Remove keyword list cruft.
- [ ] **S10.10 Migration guide** — `docs/MIGRATION-V1.md` mapping old 28 commands + `ai-runtime` → new 8 commands + `aion`. Includes PIL v1→v2 upgrade steps.

**Acceptance:**
- `npx @aionlabsai/aion init` works on fresh machine
- `docker run aionlabs/aion audit .` works on fresh machine
- `uses: aionlabs/aion-action@v0` works in `.github/workflows/`
- Aion appears in MCP registry
- Landing page loads in <2s, shows tagline + install command
- README <300 lines, leads with MCP-first positioning
- Migration guide covers every breaking change

**Files touched:** `README.md` (rewrite), `Dockerfile` (new), `.github/action.yml` (new), `docs/site/*` (new), `docs/MIGRATION-V1.md` (new), `assets/*` (new), `package.json` metadata, `.github/workflows/{publish,pages}.yml`. ~10 files.

---

## 5. Execution Waves (5 sprints)

| Wave | Sectors | Sprint goal | Risk |
|---|---|---|---|
| **W1** | 0 (hygiene) + 1 (security) | Repo clean + 5 P0 closed | Low — mechanical |
| **W2** | 2 (layers) + 3 (schemas) | Foundation restructured, one source of truth | Med — codemod correctness |
| **W3** | 4 (MCP v3) + 5 (runtime) + 6 (commands) | Contract + runtime + UX | High — biggest surface, most user-facing |
| **W4** | 7 (RAG v2) + 8 (perf) | One PIL + 5× speed | Med — dual-write v1/v2 needed |
| **W5** | 9 (tests) + 10 (distribution) | Quality + ship | Low — packaging, no behavior change |

**Total:** ~10 weeks. Each wave ends with working `main` branch + green CI. PRs link to sector IDs (e.g., `closes #S1.2`).

**Parallel workstream:** Sector 9 (tests) and Sector 10 (distribution) run in parallel with implementation waves, not after.

---

## 6. Deprecation Plan (28 commands + dual binary)

Commands removed in v1.0 (kept as deprecation shims for v1.0 + v1.1, deleted v1.2):

| Old command | Replacement | Status |
|---|---|---|
| `setup`, `setup --status`, `setup wizard` | `init` | Deprecation shim |
| `audit`, `audit --ci` | `audit` (with `--ci` flag) | Merged into single `audit` |
| `ci` | `audit --ci` | Deprecation shim |
| `ci assist` | DELETED | Cut (scaffold folded into `assist` removal) |
| `scan`, `scan api-map`, `scan env-audit`, etc. | `find` (some) + kept `scan <sub>` | Most kept |
| `scan-seo` | DELETED | Was never registered in `src/index.ts` |
| `memory`, `memory build`, `memory deps`, `memory index` | `sync` | Deprecation shim |
| `memory search` | `find --mode=semantic` | Deprecation shim |
| `memory query` | `find --mode=semantic` | Deprecation shim |
| `memory list` | `find --mode=symbol` | Deprecation shim |
| `mcp install`, `mcp serve`, `mcp doctor`, `mcp list-tools`, `mcp tail`, `mcp cost` | `mcp install\|serve\|doctor\|logs` | Consolidated |
| `workspace init`, `workspace sync`, `workspace wiki`, `workspace search`, `workspace list`, `workspace info` | Kept as `workspace` ns | Preserved |
| `init` | `init` (enhanced wizard) | Enhanced |
| `chat --history`, `chat --clear-history` | `chat history`, `chat history --clear` | Sub-commands |
| `watch` | `watch` | Preserved |
| `wiki` | `wiki` | Preserved |
| `sync` | `sync` | Preserved |
| `index` | DELETED | Replaced by `sync` |
| `analyze` | Kept (or `chat --mode=analyze`) | Decide in W3 |
| `fix` | Kept | Preserved |
| `review` | Kept | Preserved |
| `graph` | `find --mode=hotspots` | Deprecation shim |
| `churn` | `find --mode=churn` | Deprecation shim |
| `patterns` | DELETED | Cut |
| `health` | `doctor --scope=project` | Deprecation shim |
| `report` | `report` (default = latest) | Preserved |
| `explain`, `explain impact`, `explain onboard` | Kept | Preserved |
| `impact-local` | `impact` | Merged |
| `diff` | `doctor --scope=audit-diff` | Deprecation shim |
| `context` | `wiki --mode=context` | Deprecation shim |
| `tree` | `find --mode=tree` | Deprecation shim |
| `next` | `next` (enhanced with `--apply`) | Enhanced |
| `assist` | DELETED | Cut |
| `docs` | Kept | Preserved |
| `cloud` | DELETED | Cut |
| `deploy` | DELETED | Cut |
| `copilot`, `copilot quick\|safe\|release` | `copilot --mode` | Consolidated |
| `policy` | Kept | Preserved |
| `release-check` | Kept (CI tool) | Preserved |
| `doctor` | `doctor --scope=project\|mcp\|all` | Enhanced |
| `providers` | `init --provider-pick` | Merged into init |
| `search` | `find --mode=symbol` | Deprecation shim |
| `menu` | `aion` (bare = menu if no init) | Merged |
| `ai-runtime` binary | DELETED | Use `aion` |

**Net effect:** 36 commands → 8 top-level + `workspace` ns + `copilot --mode` + `chat history|clear` = **~12 visible**. 28 commands become shims or deleted.

---

## 7. Acceptance Criteria (v1.0 GA)

- [ ] All 5 P0 security issues closed (Sector 1)
- [ ] Layer boundaries enforced (`scripts/check-layers.mjs` green)
- [ ] One registry, one Finding, one Domain, one PIL
- [ ] 8 commands; deprecation banners on removed 28; migration guide published
- [ ] MCP v3 contract: versioned URIs, full `_meta`, error codes
- [ ] RAG v2 default; legacy v1 read-only
- [ ] 10k-file repo: sync <10s, audit <2min cold
- [ ] ≥80% test coverage per dir
- [ ] LICENSE + CONTRIBUTING + SECURITY + CHANGELOG + CODE_OF_CONDUCT
- [ ] README <300 lines, MCP-first positioning
- [ ] 4 distribution channels: npm + npx + Docker + GitHub Action + MCP registry
- [ ] Logo + landing page online at `aion.dev` or `aionlabs.dev`
- [ ] `aion mcp install --client {cursor,claude,codex,opencode}` tested on fresh machine for each
- [ ] Demo GIF + Show HN draft ready

---

## 8. Out of Scope (v1.x)

- Cloud hosted version (self-hosted → free; cloud → paid à la Headroom)
- SaaS pricing model (% economy or flat fee)
- Community plugin SDK (`aion plugin add <name>`)
- Database analyzers (old ROADMAP §db-*)
- Network analyzers (old ROADMAP §net-*)
- Real-time collaboration on PIL
- Web UI for PIL inspection
- VSCode extension (Cursor/Codex/OpenCode cover it)
- LangGraph as default orchestrator (kept as opt-in)

---

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Refactor breaks existing users | High | 2-release deprecation window; migration guide; aliases |
| Codemod introduces import bugs | High | Contract tests as safety net; tsc strict; pair review each PR |
| Dual-write v1/v2 creates confusion | Med | Clear `AION_PIL_V2` env toggle; legacy v1 documented as deprecated |
| Single maintainer bottleneck | High | CONTRIBUTING.md + good-first-issues + invite 1-2 co-maintainers explicitly |
| MCP SDK breaking changes | Med | Pin to 1.x; update with care; abstract via `interface/mcp/` |
| Tree-sitter multi-lang complexity | Med | Start with TS + Py + Go; defer others to plugins |
| Big-bang release risk | High | 5 waves, each shippable; no big-bang |
| Deprecation banner UX | Low | `src/cli/cli-utils.ts` shared helper; one-line override |
| Performance regressions | Med | Benchmarks in CI nightly; revert-on-regression policy |
| Brand confusion (Aion name collision) | Low | Document in README; choose subdomain (`aion.dev`) |

---

## 10. References

- 10-persona audit (Jun 2026) — internal report
- `docs/PRODUCT-VISION.md` — product vision (gateway framing)
- `docs/ARCHITECTURE.md` — technical architecture (target tree)
- `docs/adr/002-project-intelligence-layer.md` — PIL rationale
- ADR 003 (pending): Layered architecture decision
- ADR 004 (pending): Gateway positioning decision
- ADR 005 (pending): MCP v3 contract versioning
- ADR 006 (pending): FlowBuilder declarative pipelines
- ADR 007 (pending): Deprecation policy (2-release window)

---

## 11. Old Roadmap Deprecation

`ROADMAP.md` (root) is **deprecated as of v1.0**. Sections retained for context:
- §personas analysis (moved to this spec §1)
- §db-* and §net-* analyzer plans (moved to Out of Scope §8)
- §10 UX friction points from earlier audit (moved to this spec §6)
- §launch checklists (replaced by Sector 10 deliverables)

Sections deleted:
- All internal paths (`smoke:manus` references `/home/bruno/Documents/GitHub/Manus_Private`)
- PT-EN mixed language fragments
- TUI menu mockup (replaced by Sector 6.8)

**Action:** `git rm ROADMAP.md` in Sector 0.

---

**Status:** This spec is canonical. PRs link to sector IDs (e.g., `closes #S1.2`). Issues filed per sector. Quarterly review.