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

- `twin-drift`: CLAUDE.md/AGENTS.md pairs that diverged — the [most-upvoted request](https://github.com/anthropics/claude-code/issues/6235) on the Claude Code tracker at the time (native AGENTS.md support shipped later, in v2.1.277, and only reads AGENTS.md when there is no CLAUDE.md)
- `driftlint twins [--check]`: idempotent marker-block mirror + CI staleness gate
- `untracked-context`: context files git doesn't track never reach teammates or CI

## v0.11 — auto-memory audit ✅ shipped in 0.11.0

- `driftlint memory audit`: verify Claude Code's per-project auto memory against the repo — dead refs in memories, broken `[[links]]`, MEMORY.md past the load fold; other-repo memories collapse

## v0.12 — links ✅ shipped in 0.12.0

- `dead-link`: markdown link targets and `#anchor` headings inside context files, with closest-heading fixes

## v0.13 — silent config ✅ shipped in 0.13.0

- `dead-config-ref` (hooks, MCP servers, plugin manifests, skill scripts) · `silent-config` (Cursor `.md`, misplaced skills) · per-skill 1,536-char listing cut · Cursor skill discovery

## v0.14 — reference links ✅ shipped in 0.14.0

- Reference-style link support (community contribution, #9) + `ALL_CAPS` placeholder suppression

## v0.15 — precision & crash pass ✅ shipped in 0.15.0

- Ten reported bugs and false positives fixed, from a community source review — crash on unreadable Makefile, `--fix` bad write, `.github` never walked, yarn built-ins, LICENSE-style exemptions, fenced bullets, `.cursor/rules/README.md`, loose-list rationale, query strings, scoped script names, `--llm` ignore globs

## v0.16 — instruction surfaces ✅ shipped in 0.16.0

- Nested rule/skill/agent directories, Copilot instruction files, Codex rules, cross-agent skills paths, `AGENTS.override.md` (#23) · opt-in `--user-scope` for the shared 32 KB budget (#24)

## v0.17 — false positives ✅ shipped in 0.17.0

- Self-prefixed paths, nested-project hooks, small plugin skills collapsing, agent trees named `build` — all four from one user's hand-audit of a 139-finding scan · `--fix` path containment · SECURITY.md

## v0.18 — Windows & write-path correctness ✅ shipped in 0.18.0

- Community contribution (#25): Windows paths, CRLF-aware twins, Ubuntu/Windows CI on Node 20 and 22 (closes #10) · column-accurate `--fix` that no longer rewrites prose · Reviewed Memory no longer loses an approved fact to a filename collision · `cd`-scoped commands resolved against the directory the instruction names

## v0.19 — nested projects ✅ shipped in 0.19.0

- Paths written from a nested project's root resolve against that project (#27) · unresolvable references in a nested project's own documents are warnings, not errors

## v0.20 — which file actually loads ✅ shipped in 0.20.0

- AGENTS.md files Claude Code never reads because a CLAUDE.md sits above them, the `CLAUDE.local.md` trap, "read AGENTS.md" in words, the SessionStart double-load
- `dead-import`: `@path` imports of missing files, and past the four hops Claude Code follows
- `dead-glob`: path-scoped rules that match no file, across Claude, Cursor, Copilot, Kiro and Windsurf/Devin — plus a Claude rule scoped with `globs:` instead of `paths:`
- New surfaces: `.devin/rules`, `.windsurf/rules` (with the 12,000-character limit), `.kiro/steering` (and `#[[file:…]]` references), `.cursorrules`, `.cursor/commands`, `.github/prompts`, Junie, Continue, JetBrains AI Assistant
- `--format github|gitlab|azure`, and free inline PR annotations from the Action

## Later, on demand

- VS Code extension (in-process library, markdownlint model) · sandboxed dry-run of documented commands · org-wide scanning

## Non-goals

General-purpose memory frameworks, runtime guardrails, GUIs, telemetry of any kind.

---

Found a false positive? That's the most valuable issue you can open — please include the context-file line and the actual repo layout.
