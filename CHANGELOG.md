# Changelog

All notable changes to Aion will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** Versions ≤ 0.6.6 entries are reconstructed from git history.
> Future entries should follow the format below. Add entries to the top of the
> "Unreleased" section as you work; cut a release by promoting it to a versioned section.

## [Unreleased]

### Changed
- **BREAKING**: Command surface consolidated from 36 to 8 top-level commands. See `docs/MIGRATION-V1.md`.
- **BREAKING**: `ai-runtime` binary deprecated. Use `aion`.
- **BREAKING**: RAG now uses unified PIL v2 (`.ai-runtime/pil/`) — legacy v1 is read-only.

### Added
- MCP v3 contract: versioned URIs (`aion://v3/...`), complete `_meta` with real `filesChangedSince`.
- Resource templates for `modules/{name}` and `files/{path}` with cursor pagination.
- PIL manifest schema v2 with model-tagged embeddings.
- `aion --tldr` flag for non-TTY command overview.
- OpenSSF best practices: LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, dependabot.
- CI gates: typecheck, lint, contract tests, integration tests, CodeQL.

## [1.0.0] - 2026-Q3 (planned)

See [`docs/SPEC-V1.md`](docs/SPEC-V1.md) for the full v1.0 scope. Highlights:

- 8 commands: `init`, `sync`, `mcp`, `wiki`, `find`, `chat`, `doctor`, `next`.
- 4 distribution channels: npm + npx + Docker + GitHub Action + MCP registry.
- One PIL, one vector store, one schema registry, one FlowBuilder.
- 5 P0 security issues closed.

## [0.6.6] - 2026-06-24

### Added
- Policy CLI (`aion policy`) with budget caps, deny list, model selection, usage tracking.
- 33 tests for policy module.

## [0.6.0] - 2026-Q2

### Added
- Multi-repo Workspace: `aion workspace init/list/sync/info/search/wiki`.
- Cross-repo semantic search.
- Aggregated `WORKSPACE.md` view.
- Workspace detection (apps/*, packages/*, services/*).

## [0.5.0] - 2026-Q1

### Added
- MCP server with auto-sync on connect.
- File watcher with debounced resync.
- Freshness metadata (`confidence: high|medium|stale`).
- Multi-client install: Cursor, Claude Code, Codex, OpenCode.

## [0.4.0] - 2025-Q4

### Added
- Project Intelligence Layer (PIL) with `aion sync`.
- PIL v1 manifest schema (`.ai-runtime/project.json`).
- Vector index (`.ai-runtime/project.vectors.bin`).
- `aion wiki --all` generates PROJECT.md + 6 domain docs.

## [0.3.0] - 2025-Q3

### Added
- Multi-agent audit pipeline: investigator, planner, scanner, reviewer, synthesizer, developer, qa.
- 15 scan domains (security, bugs, performance, etc.).
- HTML/Markdown/JSON audit reports.

## [0.2.0] - 2025-Q2

### Added
- Interactive TUI menu (`aion menu`).
- Local zero-token scanners: secrets, env-audit, SBOM, SEO, cognitive-load.
- LLM providers: Anthropic (CLI + SDK), OpenRouter, Kimi, MiniMax.

## [0.1.0] - 2025-Q1

### Added
- Initial release.
- CLI skeleton with Commander.js.
- Anthropic provider integration.
- Basic audit flow.

---

[Unreleased]: https://github.com/aionlabs/aion/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/aionlabs/aion/compare/v0.6.6...v1.0.0
[0.6.6]: https://github.com/aionlabs/aion/compare/v0.6.0...v0.6.6
[0.6.0]: https://github.com/aionlabs/aion/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/aionlabs/aion/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/aionlabs/aion/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/aionlabs/aion/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/aionlabs/aion/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aionlabs/aion/releases/tag/v0.1.0