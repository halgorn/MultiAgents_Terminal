---
name: Bug report
about: Report a defect in Aion
title: "[BUG] "
labels: ["bug", "triage"]
assignees: []
---

## Bug Description

<!-- A clear and concise description of what the bug is. -->

## Steps to Reproduce

1. Run `...`
2. With config `...`
3. On input `...`
4. See error `...`

## Expected Behavior

<!-- What you expected to happen. -->

## Actual Behavior

<!-- What actually happened. Paste relevant output or stack trace. -->

```
<paste here>
```

## Environment

- Aion version: `aion --version` output: _____
- Node version: `node --version` output: _____
- OS: _____
- Install method: (npm global / npx / Docker / GH Action) _____

## Sector / Area

<!-- Where in the code you suspect the issue is. Reference SPEC sector if known. -->

- [ ] CLI command(s): _____
- [ ] MCP server
- [ ] RAG / PIL / sync
- [ ] Agent / flow
- [ ] Scanner
- [ ] Provider (Claude / OpenRouter / Kimi / MiniMax)
- [ ] Other: _____

## Severity

- [ ] Critical — blocks work, no workaround
- [ ] High — major feature broken
- [ ] Medium — minor feature broken, workaround exists
- [ ] Low — cosmetic / docs / typo

## Logs

<!-- Paste relevant logs from `.ai-runtime/logs/` or terminal output. -->
<!-- WARNING: redact any API keys, tokens, or secrets before pasting. -->

```bash
# To get verbose logs:
aion <cmd> --log-level debug 2>&1 | tee /tmp/aion.log
```

## Additional Context

<!-- Anything else relevant: PRs that introduced it, related issues, etc. -->