# Changelog

## 0.15.0 — 2026-09-03

A precision-and-crash pass. Every item here came from [@cemililik](https://github.com/cemililik), who read the source and filed eleven issues with file:line diagnoses — one of them with the fix attached.

**Crashes and bad writes**

- An unreadable `Makefile` (EACCES, or gone between the walk and the read) took the whole scan down with an unhandled exception; the `package.json` branch four lines up was already guarded (#14).
- `--fix` wrote replacements through a string pattern, so `$$`, `$&`, `` $` `` and `$'` in a path spliced surrounding text into the user's context file instead of the text we showed them (#13).
- `.github/` was never walked, which left `copilot-instructions.md` unreachable since the day it shipped — advertised in the README, typed, wired up, and dead (#11, fixed in #12).

**False positives**

- `yarn audit`, `yarn outdated`, `yarn workspace …` and the rest of yarn's built-ins were reported as missing package scripts, failing a yarn repo on its first run (#18).
- `LICENSE`, `CHANGELOG`, `CODEOWNERS` and friends were permanently exempt from link and path checks, because the ALL-CAPS placeholder guard swallowed them (#16).
- `load-budget` counted bullet lines inside fenced code blocks, turning a 170-line YAML example into an adherence warning (#19).
- `silent-config` flagged `.cursor/rules/README.md` — documentation about the rules, not a rule that failed to load — as an error, so `npx driftlint` exited 1 on a repo that had done nothing wrong (#20).
- `missing-rationale` only read the line after a directive, missing every reason written as a markdown loose list (bullet, blank line, indented paragraph) (#21).
- `dead-link` did not strip query strings, so `docs/x.md?plain=1` was reported as missing (#22).

**Correctness**

- `twin-drift` truncated scoped script names, naming `test` when the script is `test:unit` (#15).
- `--llm` applied the config `ignore` globs to the linted files but not to the evidence pool, so an excluded path was still grepped and pasted into the prompt (#17).

91-test suite; the two highest-severity regressions were verified to fail without their fix.

## mcp 0.1.3 — 2026-09-02

- **The MCP server was installing a stale engine.** The published `driftlint-mcp@0.1.2` pinned `^0.12.0`, which on 0.x semver means `>=0.12.0 <0.13.0` — so `npx @alifurkangokce/driftlint-mcp` ran a two-release-old scanner with no twins, silent-config or dead-config-ref rules. The pin is now a floor (`>=0.14.1 <1.0.0`) instead of a ceiling that goes stale every minor.
- A packaging test now fails the build when the pin stops covering the engine version this repo ships, so it can't happen quietly again.

## 0.14.1 — 2026-09-02

Polish from installing it globally and using it like a first-time user.

- **The freshness score no longer publishes a percentage from a handful of references.** A repo with 3 checked references could swing from 100% to 0% on one moved file; below 5 references the report omits the line and `--badge-json` writes `n/a` (grey) instead of a red `0%`.
- **`untracked-context` stays quiet in a repo with no commits yet** — every file is untracked in somebody's first five minutes, and none of it is news.
- **The personal-file hint stopped suggesting `CLAUDE.local.md` for files that have no such variant** (`.opencode/knowledge/*.md`, `.windsurfrules`, …); those now point at the `ignore` config instead.
- 77-test suite.

## 0.14.0 — 2026-09-02

The first outside contribution — thank you [@LunaMeerkats](https://github.com/LunaMeerkats).

- **Reference-style markdown links** (closes #8, contributed in #9): `[text][label]` and collapsed `[label][]` usages are resolved against their definitions, with the finding reported at the definition line (the one place an author can fix it). Definitions are collected in a first pass so a usage may precede its definition, the first definition wins (CommonMark), inline links are masked before reference scanning, and the future-artifact suppression now spans every usage line. Shortcut references (`[label]`) stay out of scope on purpose: without a full markdown parser they collide with ordinary bracketed prose.
- Precision fix found by dogfooding: `ALL_CAPS` link targets (`[ticket](TFS_LINK)`) are fill-in markers, not claims that a file exists.
- 74-test suite.

## 0.13.0 — 2026-09-02

Silent config: the JSON is valid, the file isn't there.

- **`dead-config-ref`**: hook commands, MCP server `command`/`args`, plugin/marketplace manifest paths and skill `allowed-tools` scripts are resolved against the tree — `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` expanded, plugin manifests resolved against the plugin root, did-you-mean hints from the repo index. Remote servers (`npx`, `uvx`, `docker`), machine paths, `~`, unresolvable variables and globs are skipped; `permissions.allow` entries warn while `deny`/`ask` rules are left alone.
- **`silent-config`**: a plain `.md` under `.cursor/rules` never loads ([Cursor requires `.mdc`](https://cursor.com/docs/context/rules)); a bare `.md` where `<name>/SKILL.md` belongs is never picked up. Cursor `.md` rules are no longer linted as if they were live.
- **`skill-budget`** gained the official hard cut: `description` + `when_to_use` past **1,536 characters** is truncated in the skill listing, so the tail never reaches the model.
- Skills are now discovered under `.cursor/skills/` as well as `.claude/skills/` — [Agent Skills](https://agentskills.io) is a cross-tool standard.
- Validated on six real local repos plus this one: zero false positives from the new rules. 70-test suite.

## 0.12.0 — 2026-08-25

Links are instructions too.

- **`dead-link`** (closes #2): markdown links inside context files are verified — a moved target file is an error (with a did-you-mean fix), a renamed `#anchor` heading is a warning with the closest heading offered as the fix. GitHub-flavored slugs, duplicate-heading suffixes (`#setup-1`), `{#custom-id}` attributes and `<a name>`/`id` anchors all resolve; `#L42` line anchors, external/absolute/templated targets, fenced examples and future-file prose are skipped.
- `memory audit` uses it too, so a `MEMORY.md` index pointing at a deleted topic file is caught.
- Dogfooded against 106 real index links and this repo's own README with zero false positives.
- 59-test suite.

## 0.11.0 — 2026-08-25

Auto-memory audit: agent memories decay too — and they live outside the repo where no linter looks.

- **`driftlint memory audit`**: locates Claude Code's per-project auto memory (`~/.claude/projects/<project>/memory/`, `CLAUDE_CONFIG_DIR` honored, `--dir` to override) and verifies it against the repo — dead paths and removed commands referenced in memories, broken `[[wiki-links]]` (resolved via filenames *and* frontmatter `name:` slugs, kebab/snake tolerant), and MEMORY.md past the 200-line / 25KB fold that silently never loads.
- Precision-first, dogfooded on a 107-file real memory directory: memories describing *other* repos collapse into one `foreign-context` info (same thresholds as the scanner); bare filenames warn instead of erroring; `path.ts:70-77` line-range suffixes now strip cleanly everywhere.
- Library exports: `auditMemory`, `findMemoryDir`.
- 52-test suite.

## 0.10.0 — 2026-08-25

Twins: the CLAUDE.md ↔ AGENTS.md sync problem ([anthropics/claude-code#6235](https://github.com/anthropics/claude-code/issues/6235), 5,200+ 👍, marked *not planned*).

- **`twin-drift`**: flags CLAUDE.md/AGENTS.md pairs in the same directory that carry the same instructions but diverged — command claims present in only one file, near-identical files with drifted lines, or a stale twins mirror. Evidence-gated: intentionally different files and pairs bridged with an `@AGENTS.md` import stay silent.
- **`driftlint twins`**: mirror one file into the other as a marked, idempotent block (`driftlint-twins:start/end`; default source AGENTS.md — the cross-tool standard). **`driftlint twins --check`** fails CI when the mirror is stale. Never nests memory/twins blocks.
- **`untracked-context`** (closes #3): context files git doesn't track are flagged — agents on one machine follow them, teammates and CI never see them. Distinguishes *not committed* from *gitignored*; `CLAUDE.local.md` and nested checkouts are exempt.
- 44-test suite.

## 0.9.0 — 2026-08-17

The integrations release.

- **`--rdjsonl`**: reviewdog RDFormat output where every did-you-mean fix becomes a **one-click "Apply suggestion"** on GitHub PR reviews (column-precise ranges). Recommended: `-filter-mode=nofilter` — drift findings live on lines the diff never touched.
- **`@alifurkangokce/driftlint-mcp`** (new package under `mcp/`): driftlint as an MCP server. `drift_scan` (full report, optional PR-diff range) and `drift_check` — agents verify a path/script reference **before** writing it into CLAUDE.md. stdio, lint-only philosophy (ESLint MCP model), covered by a real stdio-handshake E2E test.
- Library surface: the main package now ships `exports` + type declarations (`scan`, `diffScan`, `checkReference`, `toRdjsonl`, `toSarif`, `badgeJson`) for editors and integrations.
- Reviewed Memory: memorywire governance-channel alignment documented.
- 35-test suite.

## 0.8.0 — 2026-08-17

Load budget & honesty: will this file actually reach the model, and can anyone ever prune it?

- **`load-budget`**: AGENTS.md past Codex CLI's 32 KB silent-truncation limit is a warning (the tail never reaches the model); files past ~150 instruction-like lines get an adherence info. Nobody else answers "will it actually load?".
- **`missing-rationale`**: directive walls (never/always/must) where ≥80% carry no stated reason collapse into one info — rules whose rationale is lost are the ones nobody dares delete (arXiv 2608.11095). Reviewed Memory entries carry evidence by design.
- **Context-freshness score**: deterministic 0-100 (share of path references that resolve; template/foreign files excluded), shown in the report tail and in `--json` stats. **`--badge-json <path>`** writes shields.io endpoint JSON; the Action gained a `badge-json` input — pair with dynamic-badges-action for a README badge.
- 32-test suite.

## 0.7.0 — 2026-08-14

PR-diff mode: only the drift THIS change caused.

- **`--diff [range]`** (default `origin/main...HEAD`): scans the merge-base in a temporary git worktree, compares findings by stable fingerprint, and reports only what's new — pre-existing drift stays out of your PR. Deliberately a finding-level baseline, **not** a line filter: the headline case ("this PR renamed a file; CLAUDE.md still references it") lives on lines the diff never touched.
- **Rename/delete attribution**: new dead-path findings are cross-referenced with `git diff --name-status -M` — a rename produces *"this change renames `src/auth.ts` → `src/authn.ts`…"* with the fix derived from the rename target; a deletion says so explicitly.
- GitHub Action: new `diff: "true"` input auto-derives the range from the PR base branch.
- README repositioned: Reviewed Memory leads; new comparison matrix vs agnix/ctxlint (complements, not rivals); research links (ETH Zurich context-file evaluation, "Why Does CLAUDE.md Keep Growing?").
- 26-test suite.

## 0.6.0 — 2026-08-12

Template-repo awareness (closes #5, the main limitation from docs/precision.md).

- New `template-context` rule: skill/agent/command files with ≥2 unresolved references AND generator vocabulary ("scaffolds", "will create", "your project") collapse into one warning instead of a flood — root CLAUDE.md/AGENTS.md are never auto-suppressed (validated on 5 real repos: zero false collapses on application repos)
- Explicit escapes: a `driftlint-template` comment in the file, or `"templates": ["glob"]` in `.driftlintrc.json` — both skip path/command checks with a single info note
- 22-test suite

## 0.5.0 — 2026-08-12

Reviewed Memory (beta): agents propose, humans approve, git distributes, driftlint verifies.

- `driftlint memory propose --text ... [--scope] [--evidence] [--source]` — agents record one verified repo fact per entry under `.agent-memory/proposals/`
- `driftlint memory review` — interactive approve/reject (approve auto-syncs); `--yes` for bulk
- `driftlint memory sync` — writes the approved set as a marked block into CLAUDE.md/AGENTS.md/GEMINI.md, idempotently — works in every agent CLI that reads those files, no hooks needed
- `.agent-memory/` entries are scanned like any context file: memory that drifts from the code gets flagged
- Claude Code plugin: new `/memory-propose` command

## 0.4.1 — 2026-08-12

Precision round: every fix driven by a 160-finding hand-labeled study of 25 public repos (see docs/precision.md).

- Skip indented tree-listing entries in fences, `YYYYMM/`-style placeholders, all-caps template segments, Windows drive paths, URI-scheme tokens (`file:./db`), `.env` files, `Example:`/`e.g.` lines, runtime-artifact lines ("written to…", "created if…", copy/move destinations, "generated by…")
- Commands are now extracted only from code spans/fences ("make informed decisions" is prose, not a make target)
- `cd dir && npm run x` resolves the script against `dir/package.json`
- Findings across the study corpus: 616 → 468 (−24%), fixture suite guards every class
- New docs/precision.md — honest methodology, the meta-template-repo limitation, tracking issue #5

## 0.4.0 — 2026-08-12

The LLM pass.

- **`--llm`**: extract narrative claims ("auth goes through the BFF") from context files, grep the repo for evidence, and have Claude judge whether the code contradicts them. New `narrative-claim` warnings, marked *needs review*.
- Uses **your** Anthropic credentials (`ANTHROPIC_API_KEY` or an `ant auth login` profile) and the official `@anthropic-ai/sdk` as an **optional peer dependency** — plain `npx driftlint` stays dependency-free and never touches the network.
- `--llm-model` to pick the model (default `claude-opus-5`; `claude-haiku-4-5` as the budget option). Hard caps: 10 files, 8 claims/file; token usage printed after the pass.
- Conservative verifier: absence of evidence is "unverifiable", never "contradicted". Refusals and unparseable responses skip the file instead of failing the run.

## 0.3.0 — 2026-08-12

CI depth.

- **`--sarif`**: SARIF 2.1.0 output; the GitHub Action gained a `sarif-file` input that uploads to code scanning, so findings appear as PR annotations (needs `security-events: write`).
- **`--fix`**: interactively apply safe fixes — single-candidate "did you mean" paths and closest-script renames. `--yes` applies all; non-TTY without `--yes` touches nothing. Fixable findings are marked `✎` in the report.
- **pre-commit hook** (`.pre-commit-hooks.yaml`) for the pre-commit framework.
- **Wider discovery**: `GEMINI.md`, `.windsurfrules`, `.clinerules` (file or directory), `.opencode/{agent,command,knowledge}/**.md`.

## 0.2.0 — 2026-08-11

The trust release: precision before coverage.

- **Workspace-aware `dead-command`**: a script defined in another monorepo package is now a *location* warning ("defined in `packages/client/package.json`") instead of a false error.
- **New `foreign-context` rule**: when most of a file's path references don't resolve, findings collapse into one "this file probably describes another repo" warning instead of a flood.
- **Baseline mode** (`--update-baseline` → `.driftlint-baseline.json`): adopt driftlint on a legacy repo and only fail CI on *new* drift.
- **Config file** `.driftlintrc.json`: `ignore` globs, per-rule severity overrides (or `"off"`), `skillBudget`.
- **Real test suite** (`node:test`): per-rule fixtures plus a regression fixture for every false-positive class found while scanning 144 public repos.
- CONTRIBUTING guide + false-positive issue template — FP reports are the most valuable contribution.

## 0.1.1 — 2026-08-11

- Published to npm as `@alifurkangokce/driftlint` (npm blocks the bare name as too similar to `swiftlint`; the binary is still `driftlint`).
- False-positive fixes driven by a 24-repo pilot scan of public repos with CLAUDE.md:
  - skip tree-diagram lines (entries are parent-relative)
  - skip framework names (`Next.js`), `*.local.*` files, `path/to` templates
  - skip build/generated/placeholder segments anywhere in a path
  - downgrade bare single-segment dirs (`gateway/`) to warnings — weak evidence
- Reusable GitHub Action (`uses: alifurkangokce/driftlint@main`).
- Claude Code plugin: `/driftlint` scans and then fixes findings with approval.

## 0.1.0 — 2026-08-11

- First release. Four checks: `dead-path` (with did-you-mean hints), `dead-command`
  (npm scripts / make targets), `skill-budget` (system-prompt visibility),
  `stale-knowledge` (git churn vs. untouched context files).
- Zero-config `npx` CLI, JSON output, `driftlint-ignore` escapes, CI exit codes.
