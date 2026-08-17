# @alifurkangokce/driftlint-mcp

[driftlint](https://github.com/alifurkangokce/driftlint) as an MCP server — the linter for AI context files, itself agent-callable.

```bash
claude mcp add driftlint -- npx -y @alifurkangokce/driftlint-mcp
```

Two tools, lint-only by philosophy (like `@eslint/mcp` — the server reports, the agent applies):

- **`drift_scan`** `{path, diff_range?}` — full drift report with findings, fixes and the context-freshness score; pass `diff_range` for PR-diff mode.
- **`drift_check`** `{path, reference}` — verify a file path / npm script / make target **before** writing it into CLAUDE.md. An agent that checks its own context edits never writes a dead reference.

stdio transport; zero network; MIT.
