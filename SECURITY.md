# Security

driftlint reads context files and reports on them. This page states exactly what it touches, so you can decide whether to run it on a private repo without reading the source first. (Reading the source is still the better answer — it is a few thousand lines and has no dependencies.)

## Reporting a vulnerability

Open a [security advisory](https://github.com/alifurkangokce/driftlint/security/advisories/new), or email alifurkangokce@gmail.com. Please don't open a public issue for anything exploitable.

## What it reads

- Files under the directory you point it at: the tree walk (to know what exists) plus the contents of discovered context files — `CLAUDE.md`, `AGENTS.md`, skills, sub-agents, commands, rules, `.claude/settings.json`, `package.json`, `Makefile`, and the equivalents for other agents. `node_modules`, `.git`, and build output are skipped.
- With `--user-scope` (off by default): the **byte size** of `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`, so the shared 32 KB budget can be counted correctly. Never their contents.
- `driftlint memory audit`: Claude Code's per-project memory directory under `~/.claude/projects/`, which is where that command's whole job lives.

## What it writes

Nothing, unless you ask:

| Command | Writes |
| --- | --- |
| `driftlint scan` | nothing |
| `driftlint --fix` | edits context files, **one prompt per fix**, only on a TTY |
| `driftlint --fix --yes` | same edits with no prompt — for scripts that already reviewed the diff |
| `driftlint --update-baseline` | `.driftlint-baseline.json` |
| `driftlint --diff` | a temporary git worktree of the base commit in your OS temp directory, removed when the scan finishes |
| `driftlint twins` | the mirrored marker block in `CLAUDE.md`/`AGENTS.md` |
| `driftlint memory propose` | a proposal file under `.agent-memory/` |

`--fix` only rewrites text it already showed you, and only inside the scanned root — a finding whose resolved path escapes the root is skipped and counted (hardened in 0.17.0).

## What leaves your machine

One flag, and only that flag: **`--llm`**. It sends the content of your context files, plus excerpts of the source files they describe, to the Anthropic API using the key in `ANTHROPIC_API_KEY`, to check whether prose claims still match the code. Without the flag there is no network call anywhere in the tool.

Everything else is local:

- **No telemetry.** Not opt-out — absent. This is a [stated non-goal](ROADMAP.md#non-goals).
- **No runtime dependencies.** `package.json` has an empty `dependencies` block; `npm install` fetches TypeScript and nothing else.
- **No install scripts.** No `postinstall`, `preinstall` or `prepare` hook that runs on your machine.
- **No `eval`, no `Function`, no shell.** driftlint reads command *names* out of your docs and looks them up in `package.json` and your `Makefile`; it never runs them. The only program it starts is `git`, always with an argument array (never through a shell): `log`, `ls-files`, `check-ignore` and `rev-parse` on every scan, to judge staleness and spot untracked context files — all read-only — and, with `--diff` only, `merge-base`, `diff --name-status` and a temporary `worktree add`/`worktree remove`. *(An earlier version of this page said "no `child_process`". That was wrong: the git calls above have always been there.)*

## The MCP server

`driftlint-mcp` exposes two tools, `drift_scan` and `drift_check`. Both are read-only wrappers over the same scanner — there is no fix, write or shell tool on that surface, so an agent that reaches it can report drift and cannot edit anything.

## CI

The GitHub Action runs `driftlint scan` with `--format sarif`. It needs `contents: read` and, to upload annotations, `security-events: write`. It never needs a token with write access to your code.
