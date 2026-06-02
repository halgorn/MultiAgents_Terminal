# AI Engineering Runtime - Readiness Plan

## Current Status

The runtime is usable for large-repository audits, but not yet production-complete.
The `Manus_Private` smoke test scanned 1,396 eligible source files from a much
larger tree without a token/context failure. The process exited non-zero because
high-severity findings were reported, not because the runtime failed.

## Implemented

| Capability | Status | Notes |
|---|---:|---|
| Worktree-isolated agents | Done | Agents run in temporary Git worktrees with best-effort cleanup. |
| Runtime budgets | Done | Low, normal, and deep policies cap agents, output, and file reads. |
| Tree-sitter chunking | Done | TypeScript/TSX parser with safe line fallback for other files. |
| BM25 retrieval | Done | Exact-term retrieval for symbols, paths, and error text. |
| Hybrid memory search | Done | BM25 plus embeddings when an index exists. |
| SDK provider | Done | Uses Anthropic SDK when `ANTHROPIC_API_KEY` is set. |
| Prompt caching | Done | SDK provider caches stable system prompts. |
| Cost tracker | Partial | Accurate with SDK usage; CLI providers now report usage unavailable. |
| Audit pipeline split | Partial | Audit has its own pipeline; other flows still live in orchestrator. |
| Large repo dry-run | Done | `ai audit --dry-run` reports collection stats without agents. |
| Audit report persistence | Done | Reports are written to `.ai-runtime/reports/audit-*.json`. |
| Scale tests | Done | Synthetic 2,100-file fixture validates collection behavior. |
| Repository intelligence index | Done | `ai memory index` writes `.ai-runtime/repo-index.json` with files, symbols, imports, chunks, and probable test links. |

## Remaining P0

1. Validate a full `-n 5` audit on `Manus_Private`.
2. Add mocked provider integration tests for planner/investigator/developer/reviewer.
3. Split fix, analyze, and review flows out of `orchestrator.ts`.
4. Add Graph Agent and Tests Agent on top of `.ai-runtime/repo-index.json`.

## Test Commands

```bash
npm test
npm run test:scale
npm run smoke:manus
```

`smoke:manus` calls real agents and may consume API/CLI budget.

## Readiness Criteria

- `npm test` passes locally and in CI.
- `npm run test:scale` covers at least 2,000 files.
- `ai audit --dry-run` reports accurate file stats.
- Real provider usage is visible when SDK credentials are configured.
- CLI provider runs clearly state that token usage is unavailable.
- Full audit completes without leaked worktrees.
- All edited source files remain below 500 lines.
