# MCP Freshness Semantics

How aion tells the agent **when to trust the index** and when to re-read the source.

## Why freshness matters

A vector search returns snippets from an index. But the index is a snapshot — files may have changed since the last sync. Without a freshness signal, the agent cannot know:

- Is the cited function still in the codebase?
- Was it renamed or deleted?
- Are there new functions the index doesn't know about?

aion answers this by attaching a `confidence` field to every response.

## Confidence levels

### `high`

**The agent should cite directly.** No caveats needed.

Triggered when:
- `filesChangedSince ≤ highMaxChanged` (default: 0)
- `now - indexedAt < staleAgeSec / 4` (default: < 7.5 min)

### `medium`

**The agent may cite, but should add a caveat.** Useful for slow-changing code or recent edits.

Triggered when:
- `filesChangedSince < staleMinChanged` (default: < 3)
- `now - indexedAt < staleAgeSec` (default: < 30 min)
- AND not `high`

### `stale`

**The agent must re-read the source before citing.** The index is unreliable.

Triggered when:
- `filesChangedSince ≥ staleMinChanged` (default: ≥ 3)
- OR `now - indexedAt ≥ staleAgeSec` (default: ≥ 30 min)

## Response metadata

Every tool call and resource read returns a `_meta` object:

```json
{
  "_meta": {
    "pilVersion": 1,
    "indexedAt": "2026-06-18T12:34:56Z",
    "filesTotal": 245,
    "filesChangedSince": 0,
    "confidence": "high",
    "syncRecommended": false,
    "estTokens": 412,
    "traceId": "a1b2c3d4"
  }
}
```

| Field | Description |
|---|---|
| `pilVersion` | Schema version of the PIL the result came from |
| `indexedAt` | ISO timestamp of the last sync |
| `filesTotal` | Total files in the PIL |
| `filesChangedSince` | Number of files modified since sync (kept by watcher) |
| `confidence` | `high` \| `medium` \| `stale` |
| `syncRecommended` | `true` if server suggests a re-sync |
| `estTokens` | Estimated token cost of the response |
| `traceId` | UUID correlating the request with server logs |

## Auto-resync behavior

When `autoResync` is enabled (default `true`), the server:

1. Receives a tool call
2. Computes `confidence` for the current state
3. If `stale`:
   - Triggers incremental re-sync in the background
   - Returns the cached result with `syncRecommended: true`
   - Emits `notifications/resources/updated` when sync completes
4. If `high` or `medium`:
   - Returns the result immediately, no sync

The agent sees `syncRecommended: true` and may choose to re-issue the call after a moment, or trust the cached result if the freshness window is acceptable.

## Worked example

```
T+0:00   aion sync runs
         indexedAt = T+0:00
         filesChangedSince = 0
         confidence = high

T+0:05   Developer edits src/auth/middleware.ts
         watcher fires
         filesChangedSince = 1
         confidence = medium

T+0:12   Agent calls search_memory("auth")
         meta: { confidence: "medium", filesChangedSince: 1 }
         agent cites with caveat: "Based on index from 12min ago..."

T+0:20   Three more files edited
         filesChangedSince = 4
         confidence = stale
         meta: { confidence: "stale", syncRecommended: true }
         server kicks off incremental re-sync in background

T+0:21   Re-sync completes
         indexedAt = T+0:21
         filesChangedSince = 0
         confidence = high
         server emits notifications/resources/updated
         agent's next call gets fresh result
```

## Tuning the rules

Default thresholds are conservative. To tune for your project, edit `.aionrc.json`:

```json
{
  "mcp": {
    "freshness": {
      "highMaxChanged": 0,
      "staleMinChanged": 3,
      "staleAgeSec": 1800
    }
  }
}
```

- For monorepos with many concurrent edits, raise `staleMinChanged` to 10.
- For fast-changing prototypes, lower `staleAgeSec` to 300.
- For stable codebases, raise `staleAgeSec` to 86400 (1 day).

## See also

- [PRODUCT-VISION.md](PRODUCT-VISION.md) — overall design
- [mcp-options.md](mcp-options.md) — full option reference
- [ADR 002](adr/002-project-intelligence-layer.md) — PIL rationale
