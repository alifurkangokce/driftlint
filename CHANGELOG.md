# Changelog

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
