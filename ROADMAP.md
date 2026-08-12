# Roadmap

A linter's only capital is trust, so every release prioritizes precision before coverage.

## v0.2 — trust ✅ shipped in 0.2.0

- Real test suite: per-rule fixtures + a regression test for every false-positive class found in the wild
- Monorepo-aware `dead-command`: search all package.json files; downgrade to a warning with a location hint when the script lives in another workspace package
- "Describes another repo" heuristic: when most path references in one file can't resolve, collapse findings into a single warning instead of flooding
- Baseline mode (`--update-baseline`): adopt driftlint on a legacy repo and only fail CI on *new* drift
- `.driftlintrc.json`: ignore globs, extra context-file paths, severity overrides
- Measured precision: 160-finding hand-labeled study done — see [docs/precision.md](docs/precision.md); headline number deferred until the template-repo heuristic (#5) lands

## v0.3 — CI depth ✅ shipped in 0.3.0

- SARIF output + GitHub code-scanning annotations from the action
- pre-commit / husky hooks
- Interactive `--fix` for did-you-mean findings
- Wider discovery: GEMINI.md, `.opencode/`, `.windsurfrules`, `.clinerules`

## v0.4 — optional LLM pass ✅ shipped in 0.4.0

- `--llm`: verify narrative claims ("auth goes through the BFF") against the code with your own API key; zero behavior change without a key
- Suggested rewrites for stale paragraphs *(still open)*
- Cross-file contradiction detection *(still open)*

## v0.5 — Reviewed Memory ✅ shipped in 0.5.0 (beta)

- Agents *propose* knowledge at session end (`driftlint memory propose`)
- Humans approve via `driftlint memory review` or a plain PR
- Approved knowledge is injected at session start — Claude Code, OpenCode, Codex, Cursor
- driftlint continuously re-verifies approved knowledge, closing the loop

## Non-goals

General-purpose memory frameworks, runtime guardrails, GUIs, telemetry of any kind.

---

Found a false positive? That's the most valuable issue you can open — please include the context-file line and the actual repo layout.
