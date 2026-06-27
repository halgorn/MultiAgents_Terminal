# MCP v3 Contract — Authoritative Spec

> **Status:** Stable. Breaking changes require ADR + deprecation cycle.
> **Source of truth:** This file. Code MUST match; CI gate enforces.

## URI Scheme

All resources and prompts use the versioned scheme `aion://v3/...`. Legacy `aion://...` URIs are deprecated and will redirect to v3 with a deprecation note.

### Resources

| URI | Mime | Audience | Priority | Description |
|---|---|---|---|---|
| `aion://v3/project/context` | text/markdown | both | 0.9 | Token-budgeted project digest (~1.5k tokens) |
| `aion://v3/docs/architecture` | text/markdown | both | 0.9 | Modules, cycles, hotspots (~800 tokens) |
| `aion://v3/docs/recent-changes` | text/markdown | assistant | 0.7 | Live watcher diff (~300 tokens) |
| `aion://v3/docs/security` | text/markdown | user | 0.3 | OWASP findings (~1200 tokens) |
| `aion://v3/docs/performance` | text/markdown | user | 0.2 | Hot paths (~600 tokens) |
| `aion://v3/docs/test-coverage` | text/markdown | both | 0.5 | Untested files (~500 tokens) |
| `aion://v3/docs/dependencies` | text/markdown | both | 0.5 | Outdated deps/advisories (~700 tokens) |
| `aion://v3/docs/policy` | text/markdown | assistant | 0.8 | Mandatory agent policy |
| `aion://v3/modules/{name}` | text/markdown | both | 0.0 | Per-module deep dive (ResourceTemplate) |
| `aion://v3/files/{path}` | text/markdown | both | 0.0 | Chunked file view (ResourceTemplate, `?from=&to=`) |
| `aion://v3/health` | application/json | both | 0.0 | Server health snapshot |
| `aion://v3/observability/recent` | application/json | user | 0.0 | Last N calls (`?cursor=&limit=`) |
| `aion://v3/observability/summary` | application/json | user | 0.0 | Aggregated stats |

### Tools

| Tool | Input | Output | Freshness |
|---|---|---|---|
| `search_memory` | `{query, topK?, cwd?}` | `{results, meta}` | yes |
| `get_dep_graph` | `{cwd?}` | `{nodes, cycles, hotspots, meta}` | yes |
| `get_health_score` | `{cwd?}` | `{total, grade, topRisks, dimensions, meta}` | yes |
| `get_hot_zones` | `{limit?, offset?}` | paginated | yes |
| `get_impact` | `{file, depth?}` | `{dependents, depth, meta}` | yes |

All tools declare both `inputSchema` and `outputSchema`.

### Prompts

| Name | Arguments |
|---|---|
| `review_module` | `{path}` |
| `explain_cycle` | `{cycle}` |
| `find_security_issue` | `{area?}` |
| `summarize_recent_changes` | `{since?}` |
| `onboard_new_dev` | `{role?}` |
| `pre_pr_review` | `{base?, head?}` |

## `_meta` Shape

Every response (tool/resource/prompt) carries `_meta`:

```ts
interface AionMeta {
  // Identity
  pilVersion: number;             // semver of the PIL schema
  indexedAt: string;              // ISO timestamp of last sync
  filesTotal: number;             // total files in PIL
  filesChangedSince: number;      // ACTUAL watcher count (not 0)

  // Freshness
  confidence: "high" | "medium" | "stale";
  syncRecommended: boolean;
  syncInFlight?: boolean;

  // Economics
  estTokens: number;              // rough: ceil(text.length / 4)
  tokensSaved: number;            // max(0, rawReadCost - estTokens)

  // Tracing
  traceId: string;
  durationMs?: number;

  // Status
  status?: "ok" | "error";
  error?: string | AionError;     // see Error codes below
  pagination?: {
    cursor?: string;
    nextCursor?: string;
    total?: number;
    limit?: number;
  };
}
```

## Error Codes

| Code | When | Recoverable |
|---|---|---|
| `AION_PIL_MISSING` | no `project.json` and no auto-sync | yes — run `aion sync` |
| `AION_PIL_STALE` | freshness `stale` + `--no-auto-resync` | yes — run `aion sync` |
| `AION_PIL_CORRUPT` | `project.json` exists but unparseable | no — manual fix |
| `AION_EMBEDDING_UNAVAILABLE` | remote embedder + local fallback missing | yes — set provider |
| `AION_MODULE_NOT_FOUND` | `aion://v3/modules/{name}` unknown name | no |
| `AION_RATE_LIMIT` | search throttled | yes — backoff |
| `AION_INVALID_PATH` | path traversal blocked | no — caller bug |
| `AION_INTERNAL` | uncaught handler throw | partial |

## Notifications

- `notifications/resources/updated` — emitted only for URIs that actually changed
- `notifications/resources/list_changed` — when new doc produced
- `notifications/tools/list_changed` — when tool registry changes
- `notifications/progress` — for long `sync` tool calls (token in `_meta.progressToken`)

## Pagination

Cursor-based for collection resources:
- `aion://v3/observability/recent?cursor=&limit=` — opaque base64
- `aion://v3/docs/test-coverage?cursor=&limit=`
- `aion://v3/files/{path}?from=&to=`
- `search_memory` tool: `cursor` field in input; `pagination.nextCursor` in `_meta`

All `List*` responses respect incoming `params.cursor` and emit `nextCursor`.

## Versioning Policy

- Major version (`v3`) bumps on breaking URI or `_meta` change.
- Minor versions (additive new resources/tools) bump on minor release.
- Patch versions (bug fixes, doc) bump on patch release.
- Legacy `aion://...` URIs redirect to `aion://v3/...` with `_meta.syncRecommended=false` and `error.hint` pointing to the new URI.

## Client Compatibility

Tested and supported:
- **Cursor** ≥ 0.40 (resources + tools)
- **Claude Code** ≥ 1.0 (resources + tools + prompts)
- **Codex** ≥ 0.50 (tools + prompts)
- **OpenCode** ≥ 0.5 (tools)

## CI Gates

- `npm run test:contract` — verifies URI scheme, `_meta` shape, error code coverage
- `npm run test:integration` — spawns MCP server via stdio, roundtrips JSON-RPC
- `npm run check:doc-drift` — verifies this file matches code

## See Also

- [`docs/PRODUCT-VISION.md`](PRODUCT-VISION.md) — why MCP v3 exists
- [`docs/SPEC-V1.md`](../SPEC-V1.md) §S4 — execution plan
- [`docs/mcp.md`](../mcp.md) — migration guide from v2
- ADR 005 (pending): MCP v3 contract versioning decision