# Aion Architecture

Aion is a **multi-agent AI engineering runtime** — a CLI that audits, fixes, and analyzes codebases with the help of LLMs. This document explains how the pieces fit together as of v0.6.5.

## Layer diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  CLI surface (src/cli/)                                          │
│  ┌────────────┐  ┌─────────┐  ┌─────────┐  ┌──────────────┐      │
│  │  menu      │  │ sync    │  │ wiki    │  │  27 other    │      │
│  │  (TUI)     │  │ (PIL)   │  │ (PIL)   │  │  commands    │      │
│  └────────────┘  └─────────┘  └─────────┘  └──────────────┘      │
└────────────┬─────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────┐
│  Project Intelligence Layer (PIL)                                │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  .ai-runtime/project.json       (schemaVersion: 1)      │    │
│  │  .ai-runtime/project.vectors.bin (Float32 embeddings)     │    │
│  │  .ai-runtime/PROJECT.md         (auto-generated digest)  │    │
│  └──────────────────────────────────────────────────────────┘    │
└────────────┬─────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────┐
│  Core infrastructure (src/infra/)                                │
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
```

### Commands

| Command | Reads | Writes |
|---|---|---|
| `aion sync` | source tree | `project.json`, `project.vectors.bin` |
| `aion wiki` | `project.json` (or runs `sync` first) | `.ai-runtime/PROJECT.md` |
| `aion search` | `project.json`, `.vectors.bin` | (terminal output) |
| `aion chat` | `project.json` (as LLM context) | (terminal output) |
| `aion watch --auto-sync` | git diff | triggers `sync` + `wiki` |

## How aion compares to alternatives

| | aion | Snyk | SonarQube | Cursor |
|---|---|---|---|---|
| Local-first | ✅ | ❌ cloud | ❌ server | ✅ |
| Multi-agent orchestration | ✅ (langgraph) | ❌ | ❌ | ❌ |
| Code-aware context (PROJECT.md) | ✅ | ❌ | ❌ | partial |
| Pluggable via MCP | ✅ | ❌ | ❌ | ❌ |
| Free & OSS | ✅ MIT | ❌ | ❌ | ❌ |

The **PIL + MCP** combination is the moat: any agent that speaks MCP can plug into aion's precomputed repository intelligence.

## Directory map

```
src/
├── cli/                    # CLI surface
│   ├── commands/           # 30+ subcommands
│   ├── menu.ts             # Interactive TUI
│   └── interactive.ts      # REPL mode
├── core/                   # Orchestration
│   ├── langgraph-orchestrator.ts
│   ├── pipelines/          # audit/fix/review pipelines
│   └── state-machine.ts
├── infra/                  # PIL + building blocks
│   ├── project-store.ts    # ← PIL types + reader/writer
│   ├── project-migrate.ts  # ← legacy migration
│   ├── logger.ts           # ← structured logging
│   ├── repo-index.ts       # (legacy, still used)
│   ├── repo-vectors.ts     # (legacy, still used)
│   ├── dep-graph.ts        # (legacy, still used)
│   ├── embeddings.ts       # provider chain
│   └── ...                 # (scanners, analyzers, etc.)
├── providers/              # LLM adapters
├── mcp/                    # MCP server
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
