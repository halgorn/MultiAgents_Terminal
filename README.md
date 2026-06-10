# Aion

Multi-agent AI engineering runtime for auditing, analyzing, reviewing, and fixing code from the terminal.

## What It Does

Aion is a terminal-first engineering assistant for working inside codebases. It combines quick local scans with multi-agent AI workflows for deeper analysis.

Use it to:

- Audit a repository across security, architecture, testing, reliability, data, dependencies, and AI prompt risks.
- Analyze bugs or issue descriptions.
- Review files, diffs, or risky changes.
- Run zero-token local scans for secrets, env vars, SBOM, API maps, and cognitive load.
- Generate dependency graphs, health reports, churn reports, and onboarding guides.
- Use natural language from the terminal.

## Install

```bash
npm install -g @aionlabsai/aion
```

Verify the install:

```bash
aion --version
aion --help
```

The package also installs the `ai-runtime` command.

## Requirements

- Node.js 18 or newer
- One configured AI provider for AI-powered commands
- Git for churn and repository history features
- Optional: Semgrep for deeper static analysis integration

## Provider Setup

### Claude SDK

```bash
export ANTHROPIC_API_KEY="your_key_here"
```

### Claude CLI

Without `ANTHROPIC_API_KEY`, Aion can use an authenticated `claude` CLI session when available:

```bash
claude /login
```

### OpenRouter

```bash
export OPENROUTER_API_KEY="your_key_here"
export OPENROUTER_MODEL="moonshotai/kimi-k2"
```

### LangFuse (optional observability)

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"
```

When enabled, Aion emits observation traces for agent runs and cost lifecycle events.

### Codex

```bash
export AI_RUNTIME_CODEX_MODEL="gpt-5-codex"
```

### LangGraph (advanced, optional)

```bash
export AION_ORCHESTRATOR="langgraph"
```

When set, `analyze`, `fix`, and `review` run through a LangGraph wrapper while preserving existing pipeline behavior.

## Usage

```bash
aion --help
aion menu
aion next
aion audit .
aion analyze .
aion "review this project and find risky code"
```

## Practical Scope For Today

The main menu is intentionally small. It prioritizes flows that are ready to demo and publish:

- Works without tokens: `health`, `report`, `scan secrets`, `scan env-audit`, `scan sbom`, `scan cognitive-load`, and audit in local mode.
- Uses AI tokens: `audit` in AI mode, `fix`, `analyze`, `chat`, `review`, and natural-language requests that trigger those actions.
- Hidden from the main menu for now: DeepEval setup/run, LangGraph orchestration switching, and manual setup/indexing shortcuts. They still exist as CLI commands, but they are advanced/experimental for today's release surface.

## Interactive Menu

Run:

```bash
aion menu
```

The menu includes:

- Automatic local diagnosis: health, secrets, env vars, SBOM, and cognitive-load scans.
- Guided audit tracks for bugs, security, and performance/infra.
- Two audit modes:
  - local (zero token)
  - normal AI (uses tokens)
- File fix and issue analysis shortcuts
- Assistant direct mode
- Chat Q&A mode
- Unified report opening

## Common Commands

### Audit

```bash
aion audit . --dry-run
aion audit . --local-only
aion audit .
aion audit . --preset security
aion audit . --preset ai --budget normal
aion audit . --domains security,dependencies,compliance
aion audit . --preset security --max-files 20
aion audit . --ai-context-budget 6000
```

Useful presets:

- `security`
- `ai`
- `backend`
- `devops`
- `quality`
- `saas`
- `fintech`
- `full` requires `--force-full` because it can start every AI scanner and spend heavily.

Cost controls:

```bash
aion audit . --dry-run
aion audit . --local-only
aion audit . --preset security --scanners 2
aion audit . --preset security --max-files 20
aion audit . --preset full --force-full --budget deep --scanner-timeout 240
```

Local scans still inspect the whole repository. `--max-files` only limits the prioritized file list handed to AI scanners.

Recommended low-cost audit flow:

```bash
aion audit . --dry-run --max-files 20
aion audit . --local-only
aion audit . --preset security --scanners 2 --max-files 20
aion context --audit --budget 6000
```

This produces compact reports that are safe to send to another AI without pasting raw JSON or all source files.

### Analyze, Review, Fix

```bash
aion analyze "login fails after token refresh"
aion review src/auth/middleware.ts
aion fix "users can bypass tenant isolation"
```

### Local Scans

These scans do not require model calls:

```bash
aion scan secrets
aion scan env-audit
aion scan sbom
aion scan sbom --unpinned-only
aion scan api-map
aion scan cognitive-load
aion scan seo
aion scan seo --json --fail-under 70
aion scan seo --markdown --output reports/seo-summary.md
```

`aion scan seo` checks rendered/static Next.js route signals, robots.txt,
sitemap coverage, canonical metadata, analytics tags, Search Console hints, and
AI crawler policy. JSON and Markdown modes are useful for CI artifacts and do
not require AI tokens.

### Reports And Graphs

```bash
aion health
aion report
aion report latest
aion report --md
aion context --audit
aion context "audit report generation" --budget 8000
aion search "audit report generation" --rebuild
aion search "where reports are saved" --semantic --rebuild
aion tree --hotspots --rebuild
aion graph
aion churn
aion patterns
aion trace
```

### DeepEval

```bash
aion deepeval init
python3 -m pip install -r .ai-runtime/eval/deepeval/requirements.txt
aion deepeval run
```

### Explain And Onboard

```bash
aion explain src/index.ts
aion impact src/index.ts
aion onboard
```

### Natural Language

```bash
aion "audit this repository for dependency and secret risks"
aion "explain the auth module"
aion "find risky code in the payment flow"
```

## Runtime Files

Aion writes local runtime data under project-local or user-local folders depending on the command:

- `.ai-runtime/` for generated reports and repository indexes
- `.ai-runtime/reports/latest-audit.json` points to the latest audit run
- `.ai-runtime/reports/audits/<timestamp>/` stores organized audit output
- `.ai-memory/` for optional memory/knowledge files
- `~/.ai-runtime/` for task history unless `AI_RUNTIME_DB_PATH` is set

Each organized audit run contains:

- `index.html`
- `summary.md`
- `digest.md`
- `ai-context.md`
- `action-plan.md`
- `report.json`
- `action-items.json`
- `files-hotspots.json`
- `README.md`
- `findings-by-persona.json`
- `findings-by-severity.json`
- `findings-by-category.json`

For human reading, open `digest.md` or `index.html`.

For asking another AI to analyze the audit, use `ai-context.md` or generate a fresh compact file:

```bash
aion context --audit --budget 6000
```

## Low-Token Workflow

Run:

```bash
aion next
```

This prints the recommended sequence for avoiding large token spend. The default flow is:

```bash
aion audit . --dry-run --max-files 20
aion audit . --local-only
aion audit . --preset security --scanners 2 --max-files 20
aion context --audit --budget 6000
aion report latest
```

`aion search --semantic` uses a local deterministic vector index under `.ai-runtime/repo-vectors.json`; it does not call an AI API.

## Provider Safety

CLI subprocesses receive a minimal environment instead of the full parent shell environment. Codex `--ignore-rules` is disabled by default. To explicitly opt in:

```bash
export AION_CODEX_IGNORE_RULES=1
```

Override the task store path:

```bash
export AI_RUNTIME_DB_PATH="/path/to/aion-store"
```

## Security Checks

Recommended checks before publishing or releasing:

```bash
npm test
npm audit --audit-level=moderate
aion scan secrets
aion scan env-audit
aion scan sbom --unpinned-only
```

## Development

```bash
npm install
npm test
npm run build
node dist/index.js --help
```

Install the local checkout globally:

```bash
npm link
aion --version
```

## Publishing

Update the version, validate, then publish:

```bash
npm version patch
npm test
npm audit --audit-level=moderate
npm pack --dry-run
npm publish --access public
```

Package:

```bash
npm install -g @aionlabsai/aion
```
