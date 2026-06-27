# Aion Comparison Report

**Target:** `/home/bruno/Documents/GitHub/MultiAgents_Terminal`
**Date:** 2026-06-27T19:10:31.674Z
**Queries:** 11 (11 succeeded, 0 with-aion path failed)

---

## Summary

| Metric | Without aion | With aion (PIL v2) | Savings |
|---|---|---|---|
| **Total tokens sent to LLM** | 4,401,166 | 2,750 | **4,398,416 (99.9%)** |
| **Total retrieval time** | 416ms | 98ms | **4.2× faster** |
| **Files scanned per query** | full repo (331 files) | 5 chunks | ~99% less context |

> With-aion numbers come from `pilSearch()` — every response carries a `_meta.confidence` signal
> that says whether the index is fresh enough to trust, plus `_meta.pilVersion`, `_meta.indexedAt`,
> and per-citation provenance.

---

## Per-Query Comparison

| Query | Without aion (tokens / time) | With aion (tokens / time) | Savings |
|---|---|---|---|
| `How does authentication work?` | 400,106 (39ms) | 250 (22ms) | 99.9% tokens · 1.8× faster |
| `Where is the CLI command surface defined?` | 400,106 (34ms) | 250 (10ms) | 99.9% tokens · 3.3× faster |
| `What are the public exports of this project?` | 400,106 (38ms) | 250 (9ms) | 99.9% tokens · 4.3× faster |
| `Which files handle MCP protocol communication?` | 400,106 (40ms) | 250 (9ms) | 99.9% tokens · 4.6× faster |
| `Find all error handling patterns` | 400,106 (36ms) | 250 (7ms) | 99.9% tokens · 5.3× faster |
| `Where is the test runner entry point?` | 400,106 (51ms) | 250 (7ms) | 99.9% tokens · 7.6× faster |
| `List all files that import from 'zod'` | 400,106 (42ms) | 250 (7ms) | 99.9% tokens · 6.3× faster |
| `What functions handle git operations?` | 400,106 (30ms) | 250 (7ms) | 99.9% tokens · 4.3× faster |
| `Find all schema definitions` | 400,106 (32ms) | 250 (7ms) | 99.9% tokens · 4.3× faster |
| `Explain the agent pipeline state machine` | 400,106 (40ms) | 250 (7ms) | 99.9% tokens · 5.9× faster |
| `How does the MCP server handle freshness signals?` | 400,106 (35ms) | 250 (7ms) | 99.9% tokens · 4.8× faster |

---

## How to reproduce

```bash
# 1. Build the PIL for the target (one-time, ~30s for 10k file repos)
cd /home/bruno/Documents/GitHub/MultiAgents_Terminal
aion sync

# 2. Run this benchmark
node benchmarks/comparison/run-comparison.mjs /home/bruno/Documents/GitHub/MultiAgents_Terminal

# 3. Review report.md
```

## Notes

- **Token estimates** use `Math.ceil(text.length / 4)` — same heuristic Aion uses for `_meta.estTokens`.
- **Without aion** simulates the worst case: read every source file and include all in the LLM context.
- **With aion** uses semantic search over PIL chunks — the agent only sees the top-5 most relevant snippets.
- **Time measurement** is retrieval + parsing only — does not include LLM generation (which scales linearly with tokens sent).
- **Real LLM cost** scales with `tokensSentToLLM`. If your Claude/GPT spend is $X/month without aion, expect ~99.9% reduction with aion.
