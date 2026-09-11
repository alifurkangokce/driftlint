<!-- driftlint-twins:start — mirrored from AGENTS.md by `driftlint twins`; edit AGENTS.md, not this block -->
# driftlint

A linter for agent context files: it verifies that the claims in `CLAUDE.md`, `AGENTS.md`, skills, rule directories and agent config still hold against this repository.

## Commands

- `npm test` — builds, then runs the whole suite (`node scripts/test.mjs` explicitly lists test files for Node 20 and Windows). Always run this before committing; it is the same command CI runs.
- `npm run build` — TypeScript to `dist/`. Tests import from `dist/`, so a build is required after any source change.
- `node dist/cli.js . --no-fail` — self-scan. The fixtures under `test/fixtures/` intentionally contain drift, so a non-empty report is expected here.

## Layout

- `src/checks/` — one file per rule. A rule returns `Finding[]` and never throws; an unreadable file is skipped, because a linter that dies on one file is worse than one that skips it.
- `src/scan.ts` — orchestration: walk, discover context files, run checks, apply config overrides.
- `src/discover.ts` — the surface map (which files each agent actually loads). Patterns match at any depth.
- `test/` — one test file per release (`v10`, `v11`, …), grouped by the release that introduced the behaviour. Fixtures live in `test/fixtures/`.
- `mcp/` — the separate `@alifurkangokce/driftlint-mcp` package. Its dependency pin is verified by `test/packaging.test.js`.

## Conventions

- **Zero runtime dependencies.** The package ships with none and must keep it that way; `devDependencies` are TypeScript and types only. Reach for the standard library instead of adding a package.
- **Precision beats coverage.** A false positive costs more than a missed finding, because the first thing a new user does is judge whether the output is trustworthy. Every rule needs an escape hatch and a fixture proving it stays quiet on the cases it should ignore.
- **Every bug fix gets a regression test that fails without the fix.** Verify that it fails before you commit it, otherwise the test proves nothing.
- **Findings carry a location and, where the fix is unambiguous, a `fix`.** Only offer a fix when exactly one candidate exists; guessing rewrites the user's file for them.
- Nothing leaves the machine. No telemetry, no network calls outside the optional `--llm` pass, which uses the user's own credentials.

## Release

Bump `package.json`, add a CHANGELOG entry describing the behaviour change rather than the diff, tag `vX.Y.Z`, and publish both packages (root first, then `mcp/`).
<!-- driftlint-twins:end -->
