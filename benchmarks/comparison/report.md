# Aion Comparison Report

**Target:** `/home/bruno/Documents/GitHub/MultiAgents_Terminal`
**Date:** 2026-06-27T19:30:14.590Z
**Queries:** 11 (11 succeeded, 0 with-aion path failed)

---

## Summary

| Metric | Without aion | With aion (PIL v2) | Savings |
|---|---|---|---|
| **Total tokens sent to LLM** | 4,495,546 | 2,750 | **4,492,796 (99.9%)** |
| **Total retrieval time** | 494ms | 125ms | **3.9× faster** |
| **Files scanned per query** | full repo (339 files) | 5 chunks | ~99% less context |

> With-aion numbers come from `pilSearch()` — every response carries a `_meta.confidence` signal
> that says whether the index is fresh enough to trust, plus `_meta.pilVersion`, `_meta.indexedAt`,
> and per-citation provenance.

---

## Per-Query Comparison

| Query | Without aion (tokens / time) | With aion (tokens / time) | Savings |
|---|---|---|---|
| `How does authentication work?` | 408,686 (65ms) | 250 (37ms) | 99.9% tokens · 1.8× faster |
| `Where is the CLI command surface defined?` | 408,686 (43ms) | 250 (11ms) | 99.9% tokens · 4.0× faster |
| `What are the public exports of this project?` | 408,686 (48ms) | 250 (11ms) | 99.9% tokens · 4.5× faster |
| `Which files handle MCP protocol communication?` | 408,686 (44ms) | 250 (11ms) | 99.9% tokens · 4.0× faster |
| `Find all error handling patterns` | 408,686 (40ms) | 250 (7ms) | 99.9% tokens · 5.9× faster |
| `Where is the test runner entry point?` | 408,686 (47ms) | 250 (8ms) | 99.9% tokens · 5.6× faster |
| `List all files that import from 'zod'` | 408,686 (51ms) | 250 (7ms) | 99.9% tokens · 7.0× faster |
| `What functions handle git operations?` | 408,686 (37ms) | 250 (8ms) | 99.9% tokens · 4.7× faster |
| `Find all schema definitions` | 408,686 (38ms) | 250 (9ms) | 99.9% tokens · 4.5× faster |
| `Explain the agent pipeline state machine` | 408,686 (47ms) | 250 (9ms) | 99.9% tokens · 5.0× faster |
| `How does the MCP server handle freshness signals?` | 408,686 (34ms) | 250 (8ms) | 99.9% tokens · 4.3× faster |

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
