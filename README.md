# Aion

> **The project gateway for code-aware AI agents.**
> Cuts tokens by ~90%. Kills hallucinations via freshness metadata. Sits between your IDE and your codebase.

[![npm](https://img.shields.io/npm/v/@aionlabsai/aion)](https://www.npmjs.com/package/@aionlabsai/aion)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](.github/workflows/ci.yml)

Aion is the **RAG Confidence Layer** for Cursor, Claude Code, Codex, and OpenCode. It compresses your codebase into a token-budgeted Project Intelligence Layer (PIL), serves it via MCP, and signals on every response whether the index is fresh or stale — so the agent knows when to trust the answer and when to re-read the source.

---

## Quick Start (60 seconds)

```bash
# 1. Install (no global needed)
npx @aionlabsai/aion init

# 2. Build the Project Intelligence Layer
aion sync

# 3. Generate the context docs
aion wiki --all

# 4. Connect to your AI client
aion mcp install --client cursor     # or claude, codex, opencode

# 5. Restart your client — context is now auto-attached
```

That's it. Your agent now answers questions about your codebase grounded in a token-budgeted, freshness-tracked index.

---

## Why Aion?

| Pain | Aion fix |
|---|---|
| **10k tokens** to ask "how does auth work?" | ~800 tokens via PROJECT.md + domain docs |
| Agent **hallucinates** about your code | Every response carries `_meta.confidence` (high/medium/stale) |
| Have to re-index after every edit | File watcher auto-resyncs on stale |
| Tools lock you into one agent | Works with Cursor, Claude Code, Codex, OpenCode via MCP |
| DIY RAG is 60% features at 10x code | Single CLI, one config, one install |

**Tagline:** _RAG with receipts — every answer from your codebase, tagged with its freshness._

---

## Commands

Aion v1.0 ships **8 commands** (down from 36):

| Command | Purpose |
|---|---|
| `aion init` | First-time setup: provider pick, scope, goal |
| `aion sync` | Build/update the PIL (replaces `index`, `memory build`, `memory index`) |
| `aion mcp` | `install \| serve \| doctor \| logs` |
| `aion wiki` | Generate PROJECT.md + 6 domain docs |
| `aion find` | Search (`--mode symbol\|semantic\|hotspots\|churn`) |
| `aion chat` | Interactive codebase Q&A |
| `aion doctor` | Health check (`--scope project\|mcp\|all`) |
| `aion next` | Recommended next step |

The other 28 commands are deprecated shims that print a banner and delegate. See `docs/MIGRATION-V1.md`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  CLI (Commander.js) — 8 commands                         │
│    └── aion mcp serve  ─────────►  MCP Server (stdio)   │
│                                            │             │
│   Local Scanners (zero token)              │             │
│    • secrets   • env-audit                 │             │
│    • SBOM      • cognitive-load             ▼             │
│    • SEO       • file-size          ┌──────────────┐    │
│                                     │  PIL (.ai-   │    │
│   Agent Pipeline (uses AI)           │   runtime/)  │    │
│    • Investigator                    │  project.json│    │
│    • Planner                         │  +vectors.bin│    │
│    • Scanner (15 domains, parallel)  │  +bm25.bin   │    │
│    • Reviewer                        └──────────────┘    │
│    • Developer                                         │
└──────────────────────────────────────────────────────────┘
                                            │
                                            ▼
                                  Cursor · Claude Code
                                  Codex · OpenCode
                                  (via MCP)
```

---

## Library Use

```bash
npm install @aionlabsai/aion
```

```ts
import { createAgent, runSync } from '@aionlabsai/aion';

const result = await runSync({ cwd: './my-project', skipEmbeddings: false });
console.log(result.pil.manifest.embeddings.model);
```

See `docs/ARCHITECTURE.md` for the full type surface.

---

## Why "Gateway"?

Aion is positioned as a **gateway** (Headroom/Portkey pattern), not another audit tool. The job is:

1. **Compress** — codebase → token-budgeted PIL
2. **Validate** — every response carries freshness metadata
3. **Route** — cheap local scans first, semantic search second, full LLM last
4. **Ground** — every citation has `file:line` provenance

Compare to other categories:

| Tool | What it is | Aion's role |
|---|---|---|
| Cursor, Claude Code, Codex | The agent | Aion is what they call over MCP |
| Snyk, Semgrep | Security scanners | Aion serves their results as MCP resources with freshness |
| Aider, Cline | Repo-map agents | Aion is the repo map + RAG layer underneath |
| Headroom, Portkey | LLM gateways | Aion is the **project** gateway |

---

## Contributing

We welcome PRs. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, commit conventions, and the active [v1.0 SPEC](docs/SPEC-V1.md).

Good first issues are tagged `good-first-issue`. Security issues: see [`SECURITY.md`](SECURITY.md) — email `security@aion.dev`.

---

## License

MIT © 2026 Bruno Inácio and Aion contributors. See [LICENSE](LICENSE).