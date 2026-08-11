# Changelog

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
