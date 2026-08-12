# Contributing

Thanks for helping! Two ground rules keep driftlint useful:

1. **Precision beats coverage.** A linter that cries wolf gets uninstalled. Every new check needs fixture tests proving it stays silent on the false-positive classes in `test/fixtures/fp/`.
2. **Zero runtime dependencies, zero telemetry.** `npx` startup speed and trust are features.

## The most valuable contribution: false-positive reports

If driftlint flagged something that isn't drift, open an issue with the **False positive** template. Include the context-file line and the actual repo layout. Every confirmed FP class becomes a regression test in `test/fixtures/fp/` — that's how the tool gets trustworthy.

## Development

```bash
npm install
npm test          # build + node:test suite
node dist/cli.js <some-repo> --no-fail   # try it on a real repo
```

Adding a check: implement it under `src/checks/`, wire it in `src/scan.ts`, add a fixture under `test/fixtures/` with both positive AND negative cases, and update the README table.

## Pull requests

- Keep PRs single-purpose.
- `npm test` must pass; new behavior needs a test.
- Follow the existing code style (small modules, no classes where a function does).
