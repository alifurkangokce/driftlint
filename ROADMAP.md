# Roadmap

A linter's only capital is trust, so every release prioritizes precision before coverage.

## v0.2 — trust ✅ shipped in 0.2.0

- Real test suite: per-rule fixtures + a regression test for every false-positive class found in the wild
- Monorepo-aware `dead-command`: search all package.json files; downgrade to a warning with a location hint when the script lives in another workspace package
- "Describes another repo" heuristic: when most path references in one file can't resolve, collapse findings into a single warning instead of flooding
- Baseline mode (`--update-baseline`): adopt driftlint on a legacy repo and only fail CI on *new* drift
- `.driftlintrc.json`: ignore globs, extra context-file paths, severity overrides
- Measured precision: 160-finding hand-labeled study done — see [docs/precision.md](docs/precision.md); template-repo heuristic shipped in 0.6.0; headline number pending a re-run of the study

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

## v0.6 — template-repo awareness ✅ shipped in 0.6.0

- `template-context` rule, `driftlint-template` marker, `templates` config globs — closes the main precision-study limitation

## v0.7 — PR-diff mode ✅ shipped in 0.7.0

- `driftlint --diff`: report only drift *this change* caused — two-scan finding-level baseline (not a line filter), with rename attribution ("this PR renamed `src/auth.ts` → `src/authn.ts`; CLAUDE.md still references the old path") and perfect fixes derived from the rename

## v0.8 — load budget & honesty ✅ shipped in 0.8.0

- `load-budget` rules: will this file actually reach the model? (AGENTS.md 32KB truncation, MEMORY.md overflow, instruction-count warnings, skill budget)
- `missing-rationale`: rules without a stated reason are the ones nobody dares delete ([arXiv 2608.11095](https://arxiv.org/abs/2608.11095))
- Deterministic 0–100 drift score + shields.io badge

## v0.9 — integrations ✅ shipped in 0.9.0

- reviewdog: native rdjsonl with one-click "Apply suggestion" payloads
- `@driftlint/mcp`: `drift_scan` + `drift_check`, so agents verify context edits before writing them
- memorywire compatibility statement for Reviewed Memory

## v0.10 — twins ✅ shipped in 0.10.0

- `twin-drift`: CLAUDE.md/AGENTS.md pairs that diverged — the [5,200-reaction problem](https://github.com/anthropics/claude-code/issues/6235) Claude Code marked *not planned*
- `driftlint twins [--check]`: idempotent marker-block mirror + CI staleness gate
- `untracked-context`: context files git doesn't track never reach teammates or CI

## v0.11 — auto-memory audit ✅ shipped in 0.11.0

- `driftlint memory audit`: verify Claude Code's per-project auto memory against the repo — dead refs in memories, broken `[[links]]`, MEMORY.md past the load fold; other-repo memories collapse

## Later, on demand

- VS Code extension (in-process library, markdownlint model) · sandboxed dry-run of documented commands · org-wide scanning

## Non-goals

General-purpose memory frameworks, runtime guardrails, GUIs, telemetry of any kind.

---

Found a false positive? That's the most valuable issue you can open — please include the context-file line and the actual repo layout.
