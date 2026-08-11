# driftlint

**Your CLAUDE.md is lying to your agent.** driftlint finds the claims in your agent context files — `CLAUDE.md`, `AGENTS.md`, skills, subagents, cursor rules — that your code no longer supports.

```bash
npx driftlint
```

![driftlint demo](docs/demo.gif)

Zero config. No API key. Works on any repo.

## Why

Coding agents trust context files completely. But code moves and context files don't: the file you renamed in March is still "the entry point" in CLAUDE.md, the `deploy:prod` script you deleted is still the documented release path, and the skill you wrote last month is silently invisible because your skill descriptions overflowed the system-prompt budget.

Agent knowledge decays like code documentation always has — except now the reader can't tell something is off. It just follows the instructions.

## What it checks

| Rule | What it catches |
|---|---|
| `dead-path` | Referenced files/dirs that no longer exist — with "did you mean `src/util.ts`?" hints when the file moved |
| `dead-command` | `npm run` scripts and `make` targets that were removed or renamed |
| `skill-budget` | Skill descriptions overflowing the ~15k-char system-prompt budget — skills past it are **silently invisible** to the agent |
| `stale-knowledge` | Context files untouched for months while the code they describe churned heavily |

## Usage

```bash
npx driftlint                 # scan the current repo
npx driftlint path/to/repo    # scan another repo
npx driftlint --json          # machine-readable output (CI-friendly)
npx driftlint --no-fail       # report but always exit 0
```

Exit code is `1` when errors are found, so it drops straight into CI.

Suppress a false positive with a comment on the same line or the line above:

```markdown
<!-- driftlint-ignore -->
This mentions `hypothetical/example.ts` on purpose.
```

## Scanned files

`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` (anywhere in the tree), `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `.claude/commands/*.md`, `.cursor/rules/*`, `.github/copilot-instructions.md`.

## Claude Code plugin

driftlint also ships as a Claude Code plugin: a `/driftlint` command that runs the scan and then **fixes** the drift it finds (with your approval).

```
/plugin marketplace add alifurkangokce/driftlint
/plugin install driftlint@driftlint
```

## Roadmap

- **Phase A (now):** deterministic drift detection — paths, commands, budgets, staleness.
- **GitHub Action** and SARIF output for code-scanning annotations.
- **Optional LLM pass:** verify narrative claims ("auth goes through the BFF") against the code, using your own API key.
- **Phase B — Reviewed Memory:** agents *propose* knowledge at session end, humans approve via PR, git distributes it, and driftlint keeps it honest. Cross-CLI: Claude Code, OpenCode, Codex, Cursor.

## License

MIT
