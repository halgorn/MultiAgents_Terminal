# Pull Request

## Description

<!-- What does this PR do? Why? Link the sector ID or issue it closes. -->

Closes #

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Refactor (no functional change)
- [ ] Security fix
- [ ] Performance improvement

## Sector / Area

<!-- Reference the SPEC sector this PR advances. Examples: S1 (Security P0), S4 (MCP v3), S7 (RAG v2) -->
- [ ] S0 Hygiene
- [ ] S1 Security
- [ ] S2 Layers
- [ ] S3 Schemas
- [ ] S4 MCP
- [ ] S5 Runtime
- [ ] S6 Commands
- [ ] S7 RAG
- [ ] S8 Perf
- [ ] S9 Tests
- [ ] S10 Distribution
- [ ] Other (describe)

## Checklist

- [ ] My code follows the project's style guidelines (`npm run lint` passes)
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation (`docs/`)
- [ ] My changes generate no new warnings (`npm run typecheck` passes)
- [ ] I have added tests that prove my fix/feature works
- [ ] New and existing unit tests pass locally (`npm run test`)
- [ ] Contract tests pass (`npm run test:contract`)
- [ ] Integration tests pass (`npm run test:integration`)
- [ ] Any dependent changes have been merged and published in downstream modules

## Testing

<!-- How did you test this? What commands did you run? -->

```bash
# Commands you ran to verify
```

## Breaking Changes

<!-- If this is a breaking change, describe what users need to do to migrate. -->

- [ ] No breaking changes
- [ ] Breaking change documented in `CHANGELOG.md` under Unreleased
- [ ] Migration guide entry added to `docs/MIGRATION-V1.md`
- [ ] Deprecation banner added (if applicable)

## Screenshots / Logs

<!-- If applicable, add screenshots or paste relevant logs. -->

---

## For Maintainers

- [ ] Commit messages follow [Conventional Commits](CONTRIBUTING.md#commit-messages)
- [ ] PR title format: `<type>(<scope>): <summary>` (e.g., `feat(mcp): add v3 resource templates`)
- [ ] Files ≤ 500 lines (split if larger)
- [ ] No new top-level dependencies without justification
- [ ] Security implications reviewed (if touching MCP, agents, or providers)