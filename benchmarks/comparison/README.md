# Aion Comparison Benchmark

Side-by-side comparison of **with aion** vs **without aion** for codebase question-answering.

## What it measures

| Path | What it does | Token cost |
|---|---|---|
| **Without aion** | Reads every source file in the repo, simulates sending all to LLM | O(repo size) per query |
| **With aion** | Uses `pilSearch()` to retrieve top-5 most relevant chunks | O(query size) per query |

For each query:
- **Tokens sent to LLM** (estimated via `text.length / 4`, same heuristic Aion uses for `_meta.estTokens`)
- **Retrieval wallclock** (file walk + parsing vs vector search)
- **Match quality** (chunks returned, provenance)
- **Freshness signal** (`_meta.confidence` from PIL manifest)

## Usage

```bash
# 1. Build the PIL for your target (one-time)
cd ~/code/my-app
aion sync

# 2. Run the benchmark
node benchmarks/comparison/run-comparison.mjs ~/code/my-app

# 3. Review the report
cat benchmarks/comparison/report.md
```

Or against this repo as a smoke test:
```bash
cd /path/to/aion
aion sync
node benchmarks/comparison/run-comparison.mjs
```

## Default query set

See [`queries.md`](queries.md). 10 questions covering:
- RAG-friendly codebase questions (5)
- Symbol/file discovery (3)
- Architecture questions (2)

Edit `queries.md` to add your own.

## Output

`report.md` contains:
- Summary table (total tokens saved, time speedup)
- Per-query comparison table
- Reproduction instructions

## Limitations

- **No LLM generation** — measures retrieval only, not output quality
- **Hash fallback embedding** — real embeddings would improve with-aion relevance
- **Sync cost** — `aion sync` takes ~30s for 10k file repos; the benchmark measures per-query cost, not amortized sync cost
- **Code-only repos** — benchmarks 15 source extensions; docs/binary files excluded

## Sample output (aion self-benchmark, post-`aion sync`)

```
| Query                                            | Without aion     | With aion         | Savings              |
|--------------------------------------------------|------------------|-------------------|----------------------|
| `How does authentication work?`                  | 91,420 (220ms)   | 250 (12ms)        | -99.7% tokens · 18×  |
| `Where is the CLI command surface defined?`       | 91,420 (210ms)   | 250 (8ms)         | -99.7% tokens · 26×  |
| ...
```