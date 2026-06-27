# Migration Guide: v0.x → v1.0

This guide helps you migrate from any v0.x release to v1.0.

## TL;DR

- **One binary** instead of two (`aion` only; `ai-runtime` deprecated)
- **8 top-level commands** instead of 36 (most old commands are shims that print a banner and delegate)
- **RAG v2** is the new default; legacy v1 indexes are read-only
- **MCP URIs** are versioned (`aion://v3/...`)

## Command Mapping

### Audit

| Old | New |
|---|---|
| `aion audit .` | `aion audit .` (unchanged) |
| `aion audit . --ci` | `aion audit . --ci` |
| `aion ci .` | `aion audit . --ci` |
| `aion ci --format json` | `aion audit . --ci --format json` |

### Sync / Index

| Old | New |
|---|---|
| `aion sync` | `aion sync` (unchanged) |
| `aion index` | `aion sync` (deleted) |
| `aion memory build` | `aion sync` |
| `aion memory deps` | `aion sync` |
| `aion memory index` | `aion sync` |

### Search / Memory

| Old | New |
|---|---|
| `aion search <query>` | `aion find <query> --mode symbol` |
| `aion search <query> --semantic` | `aion find <query> --mode semantic` |
| `aion memory search <query>` | `aion find <query> --mode semantic` |
| `aion memory query <query>` | `aion find <query> --mode semantic` |
| `aion memory list` | `aion find --mode symbol` |
| `aion tree --hotspots` | `aion find --mode hotspots` |
| `aion churn` | `aion find --mode churn` |

### Analysis / Explain

| Old | New |
|---|---|
| `aion analyze <file>` | `aion chat` (interactive; choose analyze mode) |
| `aion explain <file>` | `aion explain <file>` (unchanged) |
| `aion explain impact <file>` | `aion impact <file>` |
| `aion impact-local <file>` | `aion impact <file>` |

### Health / Reports

| Old | New |
|---|---|
| `aion doctor` | `aion doctor` (unchanged) |
| `aion doctor --scope mcp` | `aion doctor --scope mcp` |
| `aion mcp doctor` | `aion doctor --scope mcp` |
| `aion health` | `aion doctor --scope project` |
| `aion report` | `aion report` (default = latest) |
| `aion diff prev latest` | `aion diff <before> <after>` |

### MCP

| Old | New |
|---|---|
| `aion mcp install --client X` | `aion mcp install --client X` (unchanged) |
| `aion mcp serve` | `aion mcp serve` (unchanged) |
| `aion mcp list-tools` | `aion mcp logs` |
| `aion mcp tail` | `aion mcp logs` |
| `aion mcp cost` | `aion mcp logs --cost` |

### Workspace

| Old | New |
|---|---|
| `aion workspace init` | `aion workspace init` (unchanged) |
| `aion workspace sync` | `aion workspace sync` (unchanged) |
| `aion workspace search` | `aion workspace search` (unchanged) |
| `aion workspace wiki` | `aion workspace wiki` (unchanged) |

### Cut (no replacement)

These commands were cut in v1.0. If you depend on them, see the v1.x roadmap for plugin replacements.

- `aion assist` → use `aion init` or generate scripts via `aion chat`
- `aion cloud` → use your cloud provider's CLI directly
- `aion deploy` → use `aion chat` for deployment planning, then your tooling
- `aion deepeval` → deepeval integration; tracked for v1.x plugin
- `aion patterns` → folded into `aion scan architecture`

## Binary

`ai-runtime` binary is deprecated. Use `aion`. The alias emits a warning on first use and will be removed in v1.2.

```bash
# Old
ai-runtime audit .

# New
aion audit .
```

## RAG Index Migration

If you have an existing v1 PIL (`.ai-runtime/project.json`), no action needed — v1 is auto-migrated to v2 on first `aion sync`. The migration is one-way and idempotent.

If you have `.ai-memory/` or legacy `repo-index.json` / `repo-vectors.json`, these are deprecated. v2 sync writes to `.ai-runtime/pil/` instead.

To force re-sync from scratch:
```bash
rm -rf .ai-runtime/
aion sync
```

## MCP Clients

If you use the MCP server with Cursor, Claude Code, Codex, or OpenCode:

- URIs are now versioned (`aion://v3/...`)
- Legacy `aion://...` URIs redirect with a hint
- `_meta.confidence` is now real (was hardcoded to `high` in some paths)
- `_meta.filesChangedSince` now reflects actual watcher state

No client config change required — auto-redirect handles it.

## Deprecation Timeline

- **v1.0** — Shims print banner, delegate to new command
- **v1.1** — Shims still work but log a warning
- **v1.2** — Shims removed

## Getting Help

- File an issue: https://github.com/aionlabs/aion/issues
- Security: security@aion.dev (see SECURITY.md)
- Discussions: https://github.com/aionlabs/aion/discussions