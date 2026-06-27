# Contributing to Aion

Thanks for your interest in contributing! Aion is the **project gateway** for code-aware AI agents — MCP server + CLI that compresses codebase context, validates freshness, and routes queries to the cheapest backend that answers correctly.

## Quick Start

```bash
git clone https://github.com/aionlabs/aion.git
cd aion
npm install
npm run build
npm link           # exposes `aion` CLI globally
aion --version
```

Run the test suite locally before opening a PR:

```bash
npm run typecheck
npm run lint
npm run test           # unit (~30s)
npm run test:contract  # registry invariants
npm run test:integration  # spawns CLI/MCP against tmp repos
```

## How to Contribute

### Bug reports
Open a GitHub issue using the **bug report template** at `.github/ISSUE_TEMPLATE/bug.md`. Include:
- Aion version (`aion --version`)
- Node version (`node --version`)
- Minimal reproduction (commands run + output)
- Relevant logs from `.ai-runtime/logs/` (if applicable)

### Feature requests
Open a GitHub issue using the **feature request template**. Check the [v1.0 SPEC](docs/SPEC-V1.md) first — the active roadmap lives there.

### Pull requests
1. Check existing issues and the SPEC before starting.
2. Open an issue first if the change is non-trivial (>100 LOC) — link it in your PR.
3. Use the PR template at `.github/PULL_REQUEST_TEMPLATE.md`.
4. Reference the sector ID you are working on (e.g., `closes #S4.9`).
5. Keep PRs small and focused. One sector/feature per PR.

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<body explaining the why, not the what>

<footer with references>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `security`.
Scopes: `cli`, `mcp`, `rag`, `agents`, `flows`, `infra`, `interface`, `domain`, `security`.

Examples:
```
feat(mcp): add v3 resource templates with pagination cursors
fix(security): validate --notify-webhook URL against SSRF allowlist
refactor(rag): unify 5 vector stores into PIL v2
```

## Architecture

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before touching core code. The architecture has 4 layers with one-direction dependencies:

```
interface/  →  application/  →  domain/
                      ↑
              infrastructure/  (implements application/ports)
```

Adding a new agent? It belongs in `src/application/agents/` with its prompt in `src/infrastructure/llm/prompts/` and schema in `src/domain/`.

Adding a new LLM provider? It belongs in `src/infrastructure/llm/providers/`. Implement the `ProviderCapabilities` interface — do **not** edit agent files.

## Good First Issues

Look for issues labeled `good-first-issue` on GitHub. These are scoped to a single sector in the SPEC and don't require deep architecture knowledge.

## Claiming a Sector

The [v1.0 SPEC](docs/SPEC-V1.md) is the source of truth. To claim work:

1. Comment on the relevant sector in an issue (or open one).
2. Get acknowledged by a maintainer.
3. Submit a PR with sector ID in the title: `[S4] MCP v3 resource templates`.

Maintainer: [@bruno](https://github.com/bruno) — please ping before starting on Sectors 4, 5, or 7 (largest surface).

## Code of Conduct

This project follows the [Contributor Covenant v2.1](CODE_OF_CONDUCT.md). Be respectful, assume good faith, focus on technical merit.

## Security

See [SECURITY.md](SECURITY.md) for disclosure policy. **Do not** file public issues for security vulnerabilities — email `security@aion.dev` instead.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).