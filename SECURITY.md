# Security Policy

## Supported Versions

Aion follows [semantic versioning](https://semver.org/). Security patches are released for the latest minor version.

| Version | Supported          |
|---------|--------------------|
| 1.x     | ✅ Active          |
| 0.7.x   | ⚠️ Critical only   |
| < 0.7   | ❌ End of life     |

## Reporting a Vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Email: **security@aion.dev**

Include:
- Description of the vulnerability
- Steps to reproduce (proof-of-concept preferred)
- Affected version(s) and configuration
- Potential impact

### Response Timeline

- **48 hours** — initial acknowledgment
- **7 days** — preliminary assessment and triage
- **30 days** — target fix and coordinated disclosure (or status update)

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure): we will work with you on a disclosure timeline that balances user safety with credit and recognition.

### What to Expect

1. **Acknowledgment** — within 48 hours of your report.
2. **Triage** — we confirm the issue, classify severity (Critical / High / Medium / Low), and scope affected versions.
3. **Fix** — patches are developed in a private fork; you are credited in the advisory.
4. **Disclosure** — once a fix is released, we publish a GHSA advisory with full credit.
5. **Recognition** — reporters are listed in the release notes (anonymity respected on request).

### Scope

In-scope:
- Aion CLI (`@aionlabsai/aion` on npm)
- MCP server (`aion mcp serve`)
- Built-in scanners, agents, and flows
- Documentation that contradicts security claims

Out-of-scope:
- LLM provider behavior (report upstream: Anthropic, OpenRouter, Kimi, etc.)
- Third-party plugins not in this repository
- Denial of service via large inputs (rate limit only)
- Issues requiring the user to run untrusted code

## Security Best Practices for Users

When running Aion on untrusted code:

```bash
# Always run on a copy, not the original repo
git clone <repo> /tmp/scan-target && cd /tmp/scan-target
aion audit .

# Don't expose MCP server beyond localhost
aion mcp serve  # stdio only by default

# Review AI-generated patches before applying
aion fix <target> --dry-run
aion fix <target> --apply
```

When running Aion on **your own** code with secrets:

- Add `.env*` to `.aionignore` (project default in v1.0+)
- Use `--local-only` to avoid sending code to LLMs
- Review `.ai-runtime/project.json` before committing (it's gitignored by default)

## Acknowledgments

We thank the following reporters for responsible disclosure:

<!-- Add reporters here as advisories are published -->