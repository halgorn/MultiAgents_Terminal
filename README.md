# Aion

Multi-agent AI engineering runtime for auditing, analyzing, reviewing, and fixing code from the terminal.

**v0.7.0** — MCP v2 with auto-sync, freshness signaling, multi-doc RAG, 11 resources, 6 prompts, multi-client install (Cursor, Claude Code, Codex, OpenCode).

Aion also acts as a **RAG Confidence Layer** for any LLM agent: it serves a unified Project Intelligence Layer (PIL) over MCP, with confidence metadata on every response so the agent knows when to trust the index vs re-read the source.

> 📘 **Read the product vision:** [docs/PRODUCT-VISION.md](docs/PRODUCT-VISION.md)
> ⚙️ **MCP options reference:** [docs/mcp-options.md](docs/mcp-options.md)
> 🔄 **Freshness semantics:** [docs/mcp.md](docs/mcp.md)

---

## What is Aion?

Aion is a CLI tool that brings a team of specialized AI agents to your terminal. You point it at a codebase, and it can:

- **Audit** — run multi-agent security, quality, and architecture reviews
- **Scan** — run zero-token local scans (secrets, env, SBOM, SEO, cognitive load)
- **Fix** — apply targeted AI-generated patches to files
- **Analyze** — reason about specific bugs or problems with full repo context
- **Chat** — answer questions about your codebase using a semantic index
- **Watch** — trigger scans automatically on file change
- **Sync** — build a unified Project Intelligence Layer (PIL) once, reuse everywhere
- **Wiki** — generate `PROJECT.md` + per-domain + per-module docs (RAG-friendly)
- **MCP serve** — act as a RAG Confidence Layer for Cursor, Claude Code, Codex, OpenCode

Every command has a **zero-token local mode** and an **AI-powered mode**. You choose the tradeoff.

---

## Quick Start: MCP with any AI Agent

```bash
# 1. Install the MCP server in your favorite client
aion mcp install --client cursor      # or claude, codex, opencode

# 2. Build the Project Intelligence Layer
aion sync                             # writes .ai-runtime/project.json

# 3. Generate the context docs
aion wiki --all                       # PROJECT.md + 6 domain docs

# 4. Restart your AI client — context is now auto-attached
```

## Quick Start: Multi-Repo Workspace

```bash
cd ~/code/my-monorepo
aion workspace init                   # detects apps/*, packages/*, services/*
aion workspace sync                   # parallel aion sync across all repos
aion workspace search "auth"          # cross-repo semantic search
aion workspace wiki                   # generates .ai-runtime/WORKSPACE.md
```

The MCP server:
- Auto-syncs the PIL on connect (no manual `aion sync` needed)
- Watches files in `src/` for changes
- Attaches `aion://project/context` (1.5k tokens) automatically
- Returns `confidence: high|medium|stale` on every response

---

## How It Works

### Architecture

```
CLI (Commander.js)
 └── Menu / REPL (interactive TUI)
      ├── Local Scanners (zero token)
      │    ├── Secrets scanner
      │    ├── Env-audit
      │    ├── SBOM / dependency graph
      │    ├── SEO crawler
      │    └── Health scorer
      └── Agent Pipeline (uses AI)
           ├── Orchestrator (routes tasks to agents)
           ├── Investigator — maps call graphs, dependencies, entry points
           ├── Planner — creates audit scope and task plan
           ├── Scanner agents — domain-specific (security, bugs, perf, etc.)
           ├── Reviewer — scores findings, eliminates false positives
           └── Developer — applies fixes and patches
```

### Agent Pipeline

When you run `aion audit .`, the pipeline executes in phases:

1. **Investigator** reads the codebase structure, builds a dependency map, and identifies entry points
2. **Planner** decides which domains to audit and how many scanners to spawn
3. **Scanner agents** run in parallel — each focuses on one domain (security, bugs, performance, etc.)
4. **Reviewer** deduplicates findings, scores severity, and eliminates false positives
5. **Report writer** produces an HTML report, markdown digest, and machine-readable JSON

### Memory & Search

Aion builds two indexes when you run `aion setup`:

- **Repo index** (`repo-index.json`) — symbol graph, import map, file metadata. Used for navigation and context building.
- **Vector index** (`repo-vectors.json`) — semantic embeddings of code chunks. Used for `aion search --semantic` and `aion chat`.

The indexes live in `.ai-runtime/` and are updated incrementally.

### Interactive Menu

Running `aion` or `aion menu` opens a keyboard-driven TUI:

- `↑↓` / `j k` — navigate items
- `/` — enter filter mode (type to narrow the list, `Esc` to exit)
- `↵` — select
- Letter shortcuts — jump directly to any item (shown as `[d]`, `[s]`, etc.)
- `q` / `Esc` — quit

On terminals ≥ 90 columns, the menu renders in **two-column layout** — left column shows the item list, right column shows a description and usage notes for the selected item.

### Scoring

Every audit produces a **health score** (0–100) computed from:

- Critical and high finding counts (weighted)
- Domain coverage
- Secret exposure, dependency risk, test coverage gaps

The score is stored in `.ai-runtime/reports/audit-history.json` and displayed as a trend sparkline in `aion health`.

---

## Install

```bash
npm install -g @aionlabsai/aion
```

```bash
aion --version
aion --help
```

---

## Quick Start

```bash
aion init              # create .ai-config.json and .aiignore
aion setup             # index codebase, build memory, install git hook
aion doctor            # verify all system components are ready
aion providers         # check which AI providers are configured
aion health            # zero-token health score + risk summary
aion menu              # interactive guided menu
```

---

## Requirements

- Node.js 18+
- Git
- One configured AI provider (for AI-powered commands)
- Optional: Semgrep for deeper static analysis

---

## Provider Setup

### Claude (recommended)

```bash
export ANTHROPIC_API_KEY="your_key_here"
```

Without a key, Aion falls back to an authenticated `claude` CLI session:

```bash
claude /login
```

### OpenRouter / Kimi

```bash
export OPENROUTER_API_KEY="your_key_here"
export OPENROUTER_MODEL="moonshotai/kimi-k2"
```

### MiniMax

```bash
export MINIMAX_API_KEY="your_key_here"
```

### Codex

```bash
export AI_RUNTIME_CODEX_MODEL="gpt-5-codex"
```

Check all configured providers:

```bash
aion providers
```

### LangFuse (optional observability)

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"
```

### LangGraph (advanced orchestrator)

```bash
export AION_ORCHESTRATOR=langgraph
```

---

## Commands

### Setup & Onboarding

```bash
aion init                        # initialize .ai-config.json + .aiignore
aion setup                       # full setup wizard (index, memory, git hook)
aion setup --status              # human-readable readiness check
aion setup --status --json       # machine-readable JSON
aion setup --reset               # reset setup state
aion doctor                      # 8-check system diagnostic with fix hints
aion doctor --json               # JSON output for CI integration
aion providers                   # show provider status and configuration
aion next                        # recommended next step based on project state
```

### Health & Trend

```bash
aion health                      # health score + risk summary + sparkline trend
aion health --json               # machine-readable health object
aion health --json --output reports/health.json
```

The health command runs all local scanners (secrets, env, SBOM, code metrics) and produces a score from 0–100 with a letter grade and top risk domains with suggested follow-up commands.

### Audit

```bash
aion audit .                              # full AI audit (all domains)
aion audit . --dry-run                    # show plan, no API calls
aion audit . --local-only                 # local scans only, zero tokens
aion audit . --preset security            # security-focused preset
aion audit . --preset ai                  # AI/prompt risk preset
aion audit . --preset backend
aion audit . --preset devops
aion audit . --preset quality
aion audit . --domains security,bugs      # specific domains only
aion audit . --scanners 2 --max-files 20  # cost controls
aion audit . --since 2024-01-01           # only files changed since date
aion audit . --budget deep                # thorough analysis
aion audit . --json                       # machine-readable output
aion audit diff                           # compare last two audits (delta view)
```

**Domains:** `security`, `bugs`, `architecture`, `performance`, `observability`, `resilience`, `data`, `dependencies`, `compliance`, `testing`, `error-handling`, `redundancy`, `multitenancy`, `prompt-audit`, `infrastructure`

**Presets:** `security`, `ai`, `backend`, `devops`, `quality`, `saas`, `fintech`, `full`

`audit diff` reads `.ai-runtime/reports/audit-history.json` and prints a delta between the last two runs — critical/high/files added or resolved, improvement or regression.

### Analyze, Review, Fix

```bash
aion analyze "login fails after token refresh"
aion review src/auth/middleware.ts
aion fix "users can bypass tenant isolation"
aion diff HEAD~1
```

`analyze` accepts a natural-language problem statement and returns a focused investigation using the repo index as context.

`fix` runs the full fix pipeline: investigate → plan → patch → verify.

### Local Scans (zero tokens)

All scanners below make no API calls and run in milliseconds to seconds.

```bash
aion scan secrets                    # detect hardcoded credentials and API keys
aion scan env-audit                  # check .env files for missing or unsafe vars
aion scan sbom                       # dependency inventory and license summary
aion scan sbom --unpinned-only       # flag unpinned dependencies
aion scan api-map                    # map all HTTP routes and handlers
aion scan cognitive-load             # flag overly complex functions
aion scan seo                        # Next.js pages, sitemap, robots, meta tags
aion scan seo --json --fail-under 70
aion scan seo --markdown --output reports/seo.md
```

### Reports & Graphs

```bash
aion report                          # open latest unified report (HTML + markdown)
aion report latest                   # same
aion report --md                     # print markdown digest to stdout
aion context --audit --budget 6000   # compact AI-ready context block
aion graph                           # open interactive dependency graph (HTML)
aion graph --no-open --output reports/graph.html
aion tree --hotspots                 # file tree weighted by churn + complexity
aion churn                           # most-changed files by git history
aion patterns                        # recurring code patterns and anti-patterns
aion trace                           # execution trace for entry points
```

### Memory & Search

```bash
aion memory index                    # build repo index (symbols, imports, chunks)
aion memory query "term"             # deterministic symbol/import lookup
aion memory build                    # build semantic vector index (RAG)
aion search "term"                   # BM25 keyword search with TUI filter
aion search "term" --semantic        # hybrid BM25 + vector search
aion search "term" --rebuild         # force re-index before searching
```

`search` results show a match score as a percentage (≥80% green, ≥50% yellow, <50% red).

### Chat & Explain

```bash
aion chat                            # persistent Q&A with full codebase context
aion chat --clear-history            # wipe chat history and start fresh
aion explain src/index.ts            # explain a file or module
aion explain src/index.ts --impact   # show what depends on this file
aion context "topic" --budget 8000
```

`chat` uses the repo index and vector search to ground answers in your actual code. Conversation history persists across sessions in `.ai-runtime/chat-history.jsonl`.

### Watch & CI

```bash
aion watch                           # poll for git changes, run scan on change
aion watch --interval 5              # poll every 5 seconds
aion watch --cmd "audit . --local-only"
aion watch --json                    # emit JSON lines for each event (pipe-friendly)
aion ci .                            # CI dry-run plan
aion ci assist                       # generate CI workflow YAML
aion copilot safe                    # pre-commit safety gate
aion copilot safe --dry-run
```

`watch --json` emits newline-delimited JSON events:
- `{type:"start", cwd, interval, cmd, ts}`
- `{type:"change", files:[], ts}`
- `{type:"scan_done", status, stdout, stderr, ts}`
- `{type:"stop", ts}`

### Deploy & Cloud

```bash
aion deploy plan --domain example.com
aion deploy apply --plan .ai-runtime/assist/deploy-plan.json
aion deploy check https://example.com/health
aion cloud status
aion assist --domain example.com
```

### Natural Language

```bash
aion "audit this repo for security issues"
aion "explain the auth module"
aion "find risky code in the payment flow"
aion                                 # opens interactive menu
```

### Eval & Advanced

```bash
aion eval retrieval                  # measure retrieval quality against test set
aion eval retrieval --rerank local --json
aion deepeval init
aion deepeval run
aion release-check                   # pre-publish validation (line limits, build, tests)
aion release-check --json
aion mcp list-tools                  # list available MCP tools
```

---

## Runtime Files

Aion writes to these locations:

```
.ai-config.json                          # project configuration
.aiignore                                # scan exclusions (same syntax as .gitignore)
.ai-runtime/
  repo-index.json                        # symbol + import index
  repo-vectors.json                      # semantic vector index
  chat-history.jsonl                     # persistent chat history
  reports/
    audit-history.json                   # health score history (trend data)
    latest-audit.json                    # pointer to latest audit
    audits/<timestamp>/
      index.html                         # visual report (open in browser)
      digest.md                          # human-readable summary
      ai-context.md                      # compact context for pasting into AI
      action-plan.md                     # prioritized fix list
      summary.md
      report.json
      action-items.json
      findings-by-severity.json
      findings-by-category.json
.ai-memory/                              # optional knowledge files (aion memory build)
~/.ai-runtime/                           # global task history (overridable)
```

Override task store:

```bash
export AI_RUNTIME_DB_PATH="/path/to/store"
```

---

## Low-Token Workflow

Zero-token commands that are always free:

```bash
aion health                              # health score and risk summary
aion scan secrets                        # credential exposure check
aion scan env-audit                      # environment variable check
aion scan sbom                           # dependency inventory
aion scan seo                            # SEO and crawler readiness
aion report                              # open last report
aion doctor                              # system health check
```

Cost-controlled AI usage:

```bash
aion next                                # see what to do next
aion audit . --dry-run --max-files 20    # estimate cost before running
aion audit . --local-only                # free local scan with no AI
aion audit . --preset security --scanners 2 --max-files 20
aion context --audit --budget 6000       # compact AI-ready context
aion audit diff                          # compare last two audits for free
```

---

## Security & Provider Safety

CLI subprocesses run in a minimal isolated environment. Codex `--ignore-rules` is disabled by default:

Agent isolation is git-only: developer, investigator, and QA agents run in disposable `git worktree` checkouts, not an OS-level sandbox. The `Bash` tool granted to those agents can still run arbitrary shell commands with your user's OS permissions (network access, other paths on disk, etc.) — worktrees confine *file edits* to a disposable branch, they do not confine *command execution*. Deny-listed files (`.env*`, `secrets/**`, `credentials/**`, `*.pem`, `*.key`) are stripped from each worktree before an agent can read them, but do not treat worktree isolation as a security sandbox.

```bash
export AION_CODEX_IGNORE_RULES=1         # explicit opt-in required
```

Pre-release security checks:

```bash
npm test
npm audit --audit-level=moderate
aion scan secrets
aion scan sbom --unpinned-only
aion release-check
```

---

## Development

```bash
npm install
npm test
npm run build
node dist/index.js --help
npm link                                 # install local checkout globally
```

Publishing:

```bash
npm version patch
npm test
node dist/index.js release-check
npm publish --access public
```
