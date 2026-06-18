# MCP Options Reference

Complete reference for all MCP server options, organized by version. Use this as the spec when implementing or extending the MCP server.

## Versioning

- **v1** — current state (legacy)
- **v2** — next release: auto-sync, observability, resources, prompts, watcher, multi-doc
- **v3** — future: freshness signaling, multi-client install

## Precedence (high → low)

> CLI flag > env var > `.aionrc.json` > hardcoded default

---

## v1 (current — already shipped)

### Commands

| Command | Description |
|---|---|
| `aion mcp serve` | Start the stdio MCP server |
| `aion mcp serve --register` | Register in `~/.claude/mcp.json` |
| `aion mcp list-tools` | List 5 hardcoded tools |

### Tools

- `search_memory` — semantic search (legacy vector-store)
- `get_dep_graph` — read dep graph (rebuilds each call)
- `get_health_score` — composite health
- `get_hot_zones` — top-N files by churn
- `get_impact` — BFS reverse on dep graph

### Limitations

- Hardcoded switch/case (no dynamic registry)
- No auto-sync, watcher, observability
- No resources, no prompts
- Reads from legacy stores, not PIL
- No multi-client install
- No freshness signaling

---

## v2 (next — auto-sufficient + multi-doc)

### New commands

| Command | Description |
|---|---|
| `aion mcp serve` | (extended with new flags) |
| `aion mcp serve --no-auto-sync` | Disable auto-sync on connect |
| `aion mcp serve --no-watch` | Disable background watcher |
| `aion mcp serve --token-budget <n>` | Limit tokens per response (default 1500) |
| `aion mcp serve --log-file <path>` | Path of persistent log (default `.ai-runtime/mcp.log`) |
| `aion mcp serve --log-level <lvl>` | `debug` \| `info` \| `warn` \| `error` |
| `aion mcp tail` | `tail -f` of the log file |
| `aion mcp tail --since <ts>` | Filter logs from timestamp |
| `aion mcp cost` | Report tokens consumed per tool call |
| `aion mcp cost --since <ts>` | Filter period |

### Environment variables

| Env var | Default | Description |
|---|---|---|
| `AION_MCP_AUTO_SYNC` | `true` | Override `--no-auto-sync` |
| `AION_MCP_WATCH` | `true` | Override `--no-watch` |
| `AION_MCP_TOKEN_BUDGET` | `1500` | Override budget |
| `AION_MCP_LOG_FILE` | `.ai-runtime/mcp.log` | Override log path |
| `AION_MCP_LOG_LEVEL` | `info` | Override log level |
| `AION_LOG_LEVEL` | `info` | Global level (from logger) |
| `AION_LOG_FORMAT` | `pretty` | `pretty` \| `json` (from logger) |

### `.aionrc.json` keys

```json
{
  "mcp": {
    "autoSync": true,
    "watch": true,
    "tokenBudget": 1500,
    "logFile": null,
    "allowedRoots": ["src", "lib"]
  }
}
```

### Resources

| URI | Description | Audience | Priority | Token cost |
|---|---|---|---|---|
| `aion://project/context` | PROJECT.md dashboard | both | 0.9 | 1500 |
| `aion://docs/architecture` | modules, deps, cycles | both | 0.9 | 800 |
| `aion://docs/recent-changes` | last N commits | assistant | 0.7 | 300 |
| `aion://docs/security` | OWASP findings | user | 0.3 | 1200 |
| `aion://docs/performance` | hot paths, complexity | user | 0.2 | 600 |
| `aion://docs/test-coverage` | gaps, untested | both | 0.5 | 500 |
| `aion://docs/dependencies` | outdated, advisories | both | 0.5 | 700 |
| `aion://docs/modules/{name}` | per-module deep dive | both | 0.0 | 400 |
| `aion://health` | server health JSON | both | 0.0 | 100 |
| `aion://observability/recent` | last 100 requests | user | 0.0 | 2000 |
| `aion://observability/summary` | aggregated stats | user | 0.0 | 300 |

### Prompts

| Prompt | Description |
|---|---|
| `aion://prompt/review_module` | Review a module for issues |
| `aion://prompt/explain_cycle` | Explain a circular dependency |
| `aion://prompt/find_security_issue` | Hunt for security issues |
| `aion://prompt/summarize_recent_changes` | Summarize recent diffs |
| `aion://prompt/onboard_new_dev` | Onboard a new dev to the repo |
| `aion://prompt/pre_pr_review` | Pre-PR review checklist |

### Transport

- `stdio` (default, only option in v2)

---

## v3 (future — freshness + multi-client install)

### New commands

| Command | Description |
|---|---|
| `aion mcp install --client <name>` | Install MCP config in target client |
| `aion mcp install --client cursor` | Cursor (`.cursor/mcp.json`) |
| `aion mcp install --client claude` | Claude Desktop (`~/.claude/mcp.json`) |
| `aion mcp install --client codex` | Codex CLI (`~/.codex/config.toml`) |
| `aion mcp install --client opencode` | OpenCode (`opencode.json`) |
| `aion mcp install --client all` | Try all clients |
| `aion mcp install --dry-run` | Show what would be written, no changes |
| `aion mcp install --uninstall` | Remove configs from all clients |
| `aion mcp doctor` | Verify integration health |
| `aion mcp doctor --client <name>` | Focus on one client |
| `aion mcp doctor --strict` | Fail on any check failure |

### Environment variables

| Env var | Default | Description |
|---|---|---|
| `AION_MCP_FRESHNESS_HIGH_MAX_CHANGED` | `0` | Max files changed for "high" |
| `AION_MCP_FRESHNESS_STALE_MIN_CHANGED` | `3` | Min files changed for "stale" |
| `AION_MCP_FRESHNESS_STALE_AGE_SEC` | `1800` | Seconds since sync for "stale" |
| `AION_MCP_AUTO_RESYNC` | `true` | Auto-resync when stale |

### `.aionrc.json` keys

```json
{
  "mcp": {
    "freshness": {
      "highMaxChanged": 0,
      "staleMinChanged": 3,
      "staleAgeSec": 1800
    },
    "autoResync": true,
    "clients": {
      "cursor": true,
      "claude": true,
      "codex": false,
      "opencode": true
    }
  }
}
```

### Response metadata (every tool/resource response)

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

### Confidence rules

| Confidence | Condition |
|---|---|
| `high` | `filesChangedSince ≤ highMaxChanged` AND `now - indexedAt < staleAgeSec / 4` |
| `medium` | `filesChangedSince < staleMinChanged` AND `now - indexedAt < staleAgeSec` |
| `stale` | `filesChangedSince ≥ staleMinChanged` OR `now - indexedAt ≥ staleAgeSec` |

### Notifications (server → client)

- `notifications/resources/updated` — when a resource changes
- `notifications/tools/list_changed` — when tools change

### New transports

- `http` — HTTP+SSE for remote clients (future)

---

## CLI flag examples

```bash
# Run with custom token budget
aion mcp serve --token-budget 4000

# Run in CI (no auto-sync, no watch)
aion mcp serve --no-auto-sync --no-watch

# Run with debug logs
AION_LOG_LEVEL=debug aion mcp serve

# JSON logs (for piping)
AION_LOG_FORMAT=json aion mcp serve | jq

# Install for all clients
aion mcp install --client all

# Verify health
aion mcp doctor --strict
```
