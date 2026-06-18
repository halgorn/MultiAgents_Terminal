# Aion Architecture

Aion is a **multi-agent AI engineering runtime** — a CLI that audits, fixes, and analyzes codebases with the help of LLMs. This document explains how the pieces fit together as of v0.7.0.

## Layer diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  CLI surface (src/cli/)                                          │
│  ┌────────────┐  ┌─────────┐  ┌─────────┐  ┌──────────────┐      │
│  │  menu      │  │ sync    │  │ wiki    │  │  28 other    │      │
│  │  (TUI)     │  │ (PIL)   │  │ (multi- │  │  commands    │      │
│  └────────────┘  └─────────┘  │  doc)   │  └──────────────┘      │
│                              └─────────┘                        │
└────────────┬─────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────┐
│  Project Intelligence Layer (PIL)                                │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  .ai-runtime/project.json       (schemaVersion: 1)      │    │
│  │  .ai-runtime/project.vectors.bin (Float32 embeddings)     │    │
│  │  .ai-runtime/PROJECT.md         (dashboard)              │    │
│  │  .ai-runtime/docs/*.md          (multi-doc, on demand)    │    │
│  │  .ai-runtime/mcp.log            (rotating, JSON lines)    │    │
│  └──────────────────────────────────────────────────────────┘    │
└────────────┬─────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────┐
│  MCP v2 server (src/mcp/) — self-sufficient + multi-client      │
│  - auto-sync on connect (auto-sync.ts)                          │
│  - background file watcher (watcher.ts)                         │
│  - observability wrapper + ring buffer (observability.ts)       │
│  - freshness engine (freshness.ts)                              │
│  - 11 resources (context, architecture, security, ...)          │
│  - 6 prompts (review_module, explain_cycle, ...)                │
│  - 5 tools (refactored, dynamic dispatch)                       │
│  - multi-client install: cursor, claude, codex, opencode       │
│  - log file with rotation (log-file.ts)                         │
└────────────┬─────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────┐
│  Core infrastructure (src/infra/)                                │
│  - project-store / project-migrate (PIL v1)                     │
│  - repo-index   (file walk, AST chunks, symbols)                 │
│  - embeddings   (Xenova, OpenAI, Voyage, FNV-1a fallback)       │
│  - dep-graph    (ts-morph + Python walker)                      │
│  - chunker      (tree-sitter TS/JS, line fallback)              │
│  - logger       (level/format config, JSON for MCP)              │
└────────────┬─────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────┐
│  Provider layer (src/providers/)                                 │
│  - Claude, OpenRouter, OpenAI, Anthropic                         │
│  - LangGraph orchestrator                                        │
│  - MCP server (exposes tools to Claude Desktop, Cursor)          │
└──────────────────────────────────────────────────────────────────┘
```

## The Project Intelligence Layer (PIL)

The PIL is the **single source of truth** for everything aion knows about a repository. See [ADR 002](adr/002-project-intelligence-layer.md) for the full design rationale.

### Lifecycle

```
   ┌───────────┐      ┌──────────┐      ┌──────────────┐
   │ git diff  │ ───► │  sync    │ ───► │ project.json │
   └───────────┘      └──────────┘      └──────┬───────┘
        ▲                                      │
        │                                      ▼
   ┌───────────┐                          ┌──────────────┐
   │  watch    │ ◄── auto-sync ────────── │  .vectors.bin│
   └───────────┘                          └──────────────┘
        │
        ▼
   ┌───────────┐
   │   wiki    │ ──► .ai-runtime/PROJECT.md
   └───────────┘
        │
        ▼ (--module, --domain, --all)
   ┌──────────────────────────┐
   │ .ai-runtime/docs/*.md    │  (multi-doc with access policy)
   └──────────────────────────┘
```

### Commands

| Command | Reads | Writes |
|---|---|---|
| `aion sync` | source tree | `project.json`, `project.vectors.bin` |
| `aion wiki` | `project.json` (or runs `sync` first) | `.ai-runtime/PROJECT.md` |
| `aion wiki --module <name>` | `project.json` | `.ai-runtime/docs/modules/<name>.md` |
| `aion wiki --domain <name>` | `project.json` | `.ai-runtime/docs/<name>.md` |
| `aion wiki --all` | `project.json` | dashboard + 6 sub-docs |
| `aion search` | `project.json`, `.vectors.bin` | (terminal output) |
| `aion chat` | `project.json` (as LLM context) | (terminal output) |
| `aion watch --auto-sync` | git diff | triggers `sync` + `wiki` |
| `aion mcp serve` | `project.json` (auto-sync on connect) | serves tools/resources/prompts via stdio |
| `aion mcp install --client <name>` | — | writes config in target client |
| `aion mcp doctor` | client configs | health report |
| `aion mcp tail` | `.ai-runtime/mcp.log` | (tail -f) |
| `aion mcp cost` | ring buffer | token consumption report |

## MCP v2 — RAG Confidence Layer

The MCP server is now **self-sufficient**. It auto-syncs the PIL on connect, watches for file changes in the background, and exposes a rich surface of tools, resources, and prompts to any MCP-compatible agent (Cursor, Claude Code, Codex, OpenCode).

### Capabilities advertised in handshake

```json
{
  "capabilities": { "tools": {}, "resources": {}, "prompts": {} }
}
```

### Resources exposed (11 total)

| URI | Audience | Priority | Token cost | Freshness |
|---|---|---|---|---|
| `aion://project/context` | both | 0.9 | 1500 | sync |
| `aion://docs/architecture` | both | 0.9 | 800 | sync |
| `aion://docs/recent-changes` | assistant | 0.7 | 300 | realtime |
| `aion://docs/security` | user | 0.3 | 1200 | sync |
| `aion://docs/performance` | user | 0.2 | 600 | sync |
| `aion://docs/test-coverage` | both | 0.5 | 500 | sync |
| `aion://docs/dependencies` | both | 0.5 | 700 | sync |
| `aion://docs/modules/{name}` | both | 0.0 | 400 | sync |
| `aion://health` | both | 0.0 | 100 | realtime |
| `aion://observability/recent` | user | 0.0 | 2000 | realtime |
| `aion://observability/summary` | user | 0.0 | 300 | realtime |

### Prompts exposed (6 total)

`review_module`, `explain_cycle`, `find_security_issue`, `summarize_recent_changes`, `onboard_new_dev`, `pre_pr_review`.

### Freshness signaling

Every response carries `_meta` with `confidence` (`high` | `medium` | `stale`) so the agent knows **when to trust** the result vs re-read the source. See [mcp.md](mcp.md).

### Multi-client install

```bash
aion mcp install --client cursor      # writes .cursor/mcp.json
aion mcp install --client claude      # writes ~/.claude/mcp.json
aion mcp install --client codex       # writes ~/.codex/config.toml
aion mcp install --client opencode    # writes opencode.json
aion mcp install --client all         # tries all
aion mcp doctor                       # verify integration
```

## How aion compares to alternatives

| | aion | Snyk | SonarQube | Cursor |
|---|---|---|---|---|
| Local-first | ✅ | ❌ cloud | ❌ server | ✅ |
| Multi-agent orchestration | ✅ (langgraph) | ❌ | ❌ | ❌ |
| Code-aware context (PROJECT.md) | ✅ | ❌ | ❌ | partial |
| Pluggable via MCP | ✅ | ❌ | ❌ | ❌ |
| Freshness signaling | ✅ | ❌ | ❌ | ❌ |
| Multi-doc with access policy | ✅ | ❌ | ❌ | ❌ |
| Free & OSS | ✅ MIT | ❌ | ❌ | ❌ |

The **PIL + MCP + freshness** combination is the moat: any agent that speaks MCP can plug into aion's precomputed, freshness-aware repository intelligence.

## Directory map

```
src/
├── cli/                    # CLI surface
│   ├── commands/           # 30+ subcommands
│   │   ├── sync.ts         # aion sync (PIL builder)
│   │   ├── wiki.ts         # aion wiki (multi-doc generator)
│   │   ├── mcp.ts          # aion mcp serve/install/doctor/tail/cost
│   │   └── ...
│   ├── menu.ts             # Interactive TUI
│   └── interactive.ts      # REPL mode
├── core/                   # Orchestration
│   ├── langgraph-orchestrator.ts
│   ├── pipelines/          # audit/fix/review pipelines
│   └── state-machine.ts
├── infra/                  # PIL + building blocks
│   ├── project-store.ts    # PIL types + reader/writer
│   ├── project-migrate.ts  # legacy migration
│   ├── logger.ts           # structured logging
│   ├── repo-index.ts       # (legacy, still used by sync)
│   ├── repo-vectors.ts     # (legacy, still used by sync)
│   ├── dep-graph.ts        # (legacy, still used by sync)
│   ├── embeddings.ts       # provider chain
│   └── ...                 # (scanners, analyzers, etc.)
├── providers/              # LLM adapters
├── mcp/                    # MCP server v2
│   ├── server.ts           # main server, capabilities, routing
│   ├── types.ts            # McpResponseMeta, Confidence, descriptors
│   ├── resources.ts        # 11 resources
│   ├── prompts.ts          # 6 prompts
│   ├── auto-sync.ts        # on-connect sync
│   ├── watcher.ts          # fs.watch wrapper
│   ├── freshness.ts        # confidence engine
│   ├── observability.ts    # ring buffer + withObservability
│   ├── log-file.ts         # rotating JSON-lines log
│   └── install.ts          # multi-client config writers
└── index.ts                # entry point
```

## Adding a new command

1. Create `src/cli/commands/<name>.ts` exporting `registerX(program: Command): void`.
2. Register in `src/index.ts`.
3. (Optional) Add to the menu in `src/cli/menu.ts`.
4. Add a `*.test.ts` next to it.

## Adding a new PIL field

1. Add the field to the `ProjectStore` interface in `src/infra/project-store.ts`.
2. Bump `PROJECT_SCHEMA_VERSION` if the change is not backwards-compatible. (Plan: v2 = breaking, add migration.)
3. Populate it in `runSync` in `src/cli/commands/sync.ts`.
4. Render it in `renderProjectMarkdown` in `src/cli/commands/wiki.ts` (if relevant for `PROJECT.md`).
5. Add tests in `src/infra/project-store.test.ts` and `src/cli/commands/sync.test.ts`.

## Adding a new MCP resource

1. Add the descriptor to `buildResourceList` in `src/mcp/resources.ts`.
2. Implement the handler function.
3. Add tests in `src/mcp/resources.test.ts`.

## Adding a new MCP prompt

1. Add the descriptor to `buildPromptList` in `src/mcp/prompts.ts`.
2. Implement the handler function.
3. Add tests in `src/mcp/prompts.test.ts`.
