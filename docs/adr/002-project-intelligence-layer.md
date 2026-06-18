# ADR 002: Project Intelligence Layer (PIL) — Unified Repository Index

## Status
Accepted — Implemented in `feat(infra): unified ProjectStore type + legacy migration (PIL v1)` and subsequent commits.

## Context
Before this change, aion had three separate persistence files produced by three separate commands:

| File | Producer | Consumer |
|---|---|---|
| `repo-index.json` | `aion index` | `aion search`, `aion memory index`, agents |
| `repo-vectors.json` | `aion index` | `aion search` |
| dep graph | `aion memory deps` | `aion memory search`, audit pipelines |

Symptoms:
1. **Redundancy**: `aion memory index` and `aion index` both walked the same source tree and produced overlapping metadata.
2. **Drift**: A user could run `aion index` (updating `repo-index.json`) without `aion memory deps` (updating the dep graph), leading to inconsistent state.
3. **No contract**: Each file had its own version field, its own hash semantics, and its own migration story (none).
4. **Cost**: `aion search` had to read two files and reconcile their hashes to detect staleness.

## Decision
Introduce the **Project Intelligence Layer (PIL)** — a single, versioned, self-describing artifact persisted at `.ai-runtime/project.json` (with `.ai-runtime/project.vectors.bin` for the Float32 embeddings).

### Schema (v1)
```ts
interface ProjectStore {
  schemaVersion: 1;
  generatedAt: string;
  root: string;
  repoHash: string;       // sha1 of files[] (path:bytes:loc), enables incremental sync
  files: RepoFile[];      // AST-extracted files
  symbols: RepoSymbol[];  // functions, classes, exports
  imports: RepoImport[];  // resolved imports
  chunks: RepoChunk[];    // tree-sitter AST spans
  tests: TestLink[];      // source ↔ test mappings
  embeddings: {
    model: string;        // e.g. 'Xenova/jina-embeddings-v2-base-code'
    dim: number;          // 384, 768, 1536 depending on provider
    vectorsPath: string;  // relative to .ai-runtime/
    count: number;
  };
  deps: {
    nodes: DepNode[];     // module-level imports/exports/loc
    cycles: string[][];   // circular dependencies
    hotspots: DepHotspot[]; // high fan-in/fan-out files
  };
  stats: { ... };
}
```

### Operations
- **`aion sync`** — single entry point that produces the PIL. Accepts `--skip-embeddings` (faster, no semantic search) and `--migrate-only` (one-shot legacy upgrade).
- **`aion wiki`** — emits a token-budgeted `PROJECT.md` derived from the PIL. Auto-runs `sync` if the PIL is missing.
- **`aion watch --auto-sync`** — runs `sync` + `wiki` on every git diff change.

### Migration
A `migrateFromLegacy(cwd)` function reads the old `repo-index.json` + `repo-vectors.json` and produces a PIL v1. The `needsMigration(cwd)` predicate is checked at the start of every `aion sync`. The migration is one-way: once you have a `project.json` at the current `schemaVersion`, the legacy files are ignored.

## Consequences

### Positive
- **One source of truth** for repository intelligence.
- **One command to refresh** (`aion sync`) instead of three.
- **Versioned schema** with explicit migration path.
- **Incremental sync** is now possible — `isProjectStoreFresh(cwd, files)` is O(n) but cheap; full rebuild is the fallback.
- **Cheaper hybrid search** — `aion search` reads one file, not two.

### Negative
- **Migration risk** — users on old versions may have weird `repo-vectors.json` states. The migration utility handles version=1 cleanly; corrupted files are ignored.
- **Larger blast radius** — a bug in `runSync` invalidates one big artifact instead of three small ones. Mitigated by schema versioning.
- **Backwards compat** — `aion index` is still available and writes both old and new formats on first run. Old consumers keep working.

## Alternatives Considered

### A. Keep three files, add a manifest
Rejected: doesn't fix drift, just adds a layer of indirection.

### B. SQLite instead of JSON
Rejected for now: JSON is human-inspectable, easier to debug, and the data sizes are modest. Revisit when a single repo exceeds 10MB of `project.json`.

### C. Per-file caching
Considered. The `repoHash` enables this in a future iteration, but the current `runSync` does a full rebuild. The cost is acceptable because:
- `aion sync` is idempotent and the dev loop expects it to take seconds, not milliseconds.
- Incremental sync is a separate optimization (file-watching already covers the dev loop).

## Open Questions
- When should `aion index` be removed? (Proposal: after two minor versions of deprecation warnings.)
- Should `aion chat` consume `PROJECT.md` automatically, or only when the user passes it? (Current: manual.)
- Should the PIL be committed to git, or always gitignored? (Current: gitignored. Future option: commit `.ai-runtime/PROJECT.md` for sharing.)
