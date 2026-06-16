# Aion

Multi-agent AI engineering runtime for auditing, analyzing, reviewing, and fixing code from the terminal.

**v0.5.1** — 36 commands, agents-first UX, setup wizard, provider detection, persistent memory.

## Install

```bash
npm install -g @aionlabsai/aion
```

```bash
aion --version
aion --help
```

## Quick Start

```bash
aion init              # initialize project config
aion setup             # index codebase, build memory, install git hook
aion next              # see recommended next step
aion doctor            # check all system components
aion providers         # check which AI providers are configured
aion menu              # interactive guided menu
```

## Requirements

- Node.js 18+
- Git
- One configured AI provider (for AI-powered commands)
- Optional: Semgrep for deeper static analysis

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
aion init                       # initialize .ai-config.json + .aiignore
aion setup                      # full setup wizard (index, memory, git hook)
aion setup --status             # human-readable readiness check
aion setup --status --json      # machine-readable JSON
aion setup --reset              # reset setup state
aion doctor                     # 8-check system diagnostic with fix hints
aion providers                  # show provider status and configuration
aion next                       # recommended next step based on project state
```

### Audit

```bash
aion audit .                              # full AI audit
aion audit . --dry-run                    # show what would run, no API calls
aion audit . --local-only                 # local scans only, no tokens
aion audit . --preset security            # security-focused preset
aion audit . --preset ai                  # AI/prompt risk preset
aion audit . --preset backend
aion audit . --preset devops
aion audit . --preset quality
aion audit . --domains security,bugs      # specific domains only
aion audit . --scanners 2 --max-files 20  # cost controls
aion audit . --since 2024-01-01           # only files changed since date
aion audit . --budget deep                # thorough analysis
```

Presets: `security`, `ai`, `backend`, `devops`, `quality`, `saas`, `fintech`, `full` (requires `--force-full`).

### Analyze, Review, Fix

```bash
aion analyze "login fails after token refresh"
aion review src/auth/middleware.ts
aion fix "users can bypass tenant isolation"
aion diff HEAD~1
```

### Local Scans (zero tokens)

```bash
aion scan secrets
aion scan env-audit
aion scan sbom
aion scan sbom --unpinned-only
aion scan api-map
aion scan cognitive-load
aion scan seo
aion scan seo --json --fail-under 70
aion scan seo --markdown --output reports/seo.md
```

### Reports & Graphs

```bash
aion health
aion health --json --output reports/health.json
aion report
aion report latest
aion report --md
aion context --audit --budget 6000
aion graph
aion graph --no-open --output reports/graph.html
aion tree --hotspots
aion churn
aion patterns
aion trace
```

### Memory & Search

```bash
aion memory index               # build repo index (symbols, imports, chunks)
aion memory query "term"        # deterministic lookup
aion memory build               # build semantic vector index (RAG)
aion search "term"              # BM25 search with TUI filter
aion search "term" --semantic   # hybrid BM25 + vector search
aion search "term" --rebuild    # force re-index
```

### Chat & Explain

```bash
aion chat                       # persistent Q&A with codebase context
aion explain src/index.ts       # file/module explanation
aion context "topic" --budget 8000
```

### Watch & CI

```bash
aion watch                      # trigger audit on file change
aion ci .                       # CI dry-run plan
aion ci assist                  # generate CI workflow
aion copilot safe               # safe AI guard workflow
aion copilot safe --dry-run
```

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
aion                            # opens interactive menu or REPL
```

### Eval & Advanced

```bash
aion eval retrieval             # retrieval quality evaluation
aion eval retrieval --rerank local --json
aion deepeval init
aion deepeval run
aion release-check              # pre-publish validation
aion release-check --json
aion mcp list-tools
```

---

## Runtime Files

Aion writes to these locations:

```
.ai-config.json                          # project configuration
.aiignore                                # scan exclusions
.ai-runtime/
  repo-index.json                        # symbol + import index
  repo-vectors.json                      # semantic vector index
  reports/
    latest-audit.json                    # pointer to latest audit
    audits/<timestamp>/
      index.html                         # visual report
      digest.md                          # human summary
      ai-context.md                      # compact context for AI
      action-plan.md
      summary.md
      report.json
      action-items.json
      findings-by-severity.json
      findings-by-category.json
.ai-memory/                              # optional knowledge files
~/.ai-runtime/                           # task history (overridable)
```

Override task store:

```bash
export AI_RUNTIME_DB_PATH="/path/to/store"
```

---

## Low-Token Workflow

```bash
aion next                                # see what to do
aion audit . --dry-run --max-files 20    # estimate cost
aion audit . --local-only                # free local scan
aion audit . --preset security --scanners 2 --max-files 20
aion context --audit --budget 6000       # compact AI-ready context
aion report latest                       # open last report
```

---

## Security & Provider Safety

CLI subprocesses run in a minimal isolated environment. Codex `--ignore-rules` is disabled by default:

```bash
export AION_CODEX_IGNORE_RULES=1         # explicit opt-in
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
npm run release-check
npm publish --access public
```
