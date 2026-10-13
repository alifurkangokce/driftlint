# driftlint — Claude Code plugin

driftlint checks whether the instruction files your coding agents read are still true. It resolves every path, script, link, `@import` and config reference in `CLAUDE.md`, `AGENTS.md`, skills, rules and agent config against the actual repository, and reports the ones that no longer hold — plus the files an agent never loads at all, such as an `AGENTS.md` that Claude Code skips because a `CLAUDE.md` sits above it.

## Commands

- `/driftlint` — scans the current repository and proposes a fix for each finding. It shows you every proposed edit and changes nothing until you approve.
- `/memory-propose` — turns what this session verified about the repository into review-ready proposals for your team's shared memory. You approve or reject them; the agent never approves on your behalf.

## What this plugin runs, reads, writes and sends

Both commands run one exact, pinned version of the scanner from the npm registry:

```
npx -y @alifurkangokce/driftlint@0.20.0
```

- **Network:** npm downloads that package the first time it runs. The package has zero runtime dependencies, so nothing else is resolved at install time. After that, the scanner makes no network calls. It has an optional flag that calls the Anthropic API with your own key, and neither command uses it.
- **Reads:** files inside the repository you run it in. The only program it starts is `git`, read-only (`log`, `ls-files`, `check-ignore`, `rev-parse`), through an argument array, never a shell. It never executes the commands it finds documented in your files.
- **Writes:** `/driftlint` edits your context files only after you approve each change. `/memory-propose` writes proposal files under `.agent-memory/proposals/` in your repository.
- **Telemetry:** none.

Source, full security statement and changelog: https://github.com/alifurkangokce/driftlint — see `SECURITY.md`. MIT licensed.
