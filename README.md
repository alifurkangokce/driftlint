# driftlint

[![npm](https://img.shields.io/npm/v/%40alifurkangokce%2Fdriftlint)](https://www.npmjs.com/package/@alifurkangokce/driftlint) [![ci](https://github.com/alifurkangokce/driftlint/actions/workflows/ci.yml/badge.svg)](https://github.com/alifurkangokce/driftlint/actions/workflows/ci.yml) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Your CLAUDE.md is lying to your agent.** driftlint finds the claims in your agent context files — `CLAUDE.md`, `AGENTS.md`, skills, subagents, cursor rules — that your code no longer supports.

```bash
npx @alifurkangokce/driftlint
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
| `foreign-context` | A file whose references mostly don't resolve — probably describes another repo; findings collapse into one warning instead of a flood |

`dead-command` is workspace-aware: a script that exists in another monorepo package is reported as a *location* warning ("defined in `packages/client/package.json`"), not a dead command.

## Usage

```bash
npx @alifurkangokce/driftlint                 # scan the current repo
npx @alifurkangokce/driftlint path/to/repo    # scan another repo
npx @alifurkangokce/driftlint --fix           # interactively apply safe fixes (--yes: all)
npx @alifurkangokce/driftlint --json          # machine-readable output (CI-friendly)
npx @alifurkangokce/driftlint --sarif         # SARIF 2.1.0 for GitHub code scanning
npx @alifurkangokce/driftlint --no-fail       # report but always exit 0
```

Installed globally (`npm i -g @alifurkangokce/driftlint`) the command is just `driftlint`.

Exit code is `1` when errors are found, so it drops straight into CI. Or use the action:

```yaml
# .github/workflows/driftlint.yml
on: [pull_request]
permissions:
  security-events: write   # only needed when sarif-file is set
jobs:
  driftlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # full history enables the staleness check
      - uses: alifurkangokce/driftlint@main
        with:
          sarif-file: driftlint.sarif   # optional: findings become PR annotations
```

Or as a [pre-commit](https://pre-commit.com) hook:

```yaml
repos:
  - repo: https://github.com/alifurkangokce/driftlint
    rev: v0.3.0
    hooks:
      - id: driftlint
```

### Adopting on a legacy repo

```bash
npx @alifurkangokce/driftlint --update-baseline   # record today's findings
```

This writes `.driftlint-baseline.json`; from then on only **new** drift is reported, so CI stays green while you pay down the backlog.

### Config

Optional `.driftlintrc.json` at the repo root:

```json
{
  "skillBudget": 15000,
  "ignore": ["docs/archive/**"],
  "rules": { "dead-command": "off", "stale-knowledge": "info" }
}
```

Suppress a single false positive with a comment on the same line or the line above:

```markdown
<!-- driftlint-ignore -->
This mentions `hypothetical/example.ts` on purpose.
```

## Scanned files

`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `GEMINI.md` (anywhere in the tree), `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `.claude/commands/*.md`, `.cursor/rules/*`, `.github/copilot-instructions.md`, `.windsurfrules`, `.clinerules` (file or directory), `.opencode/{agent,command,knowledge}/**.md`.

## Claude Code plugin

driftlint also ships as a Claude Code plugin: a `/driftlint` command that runs the scan and then **fixes** the drift it finds (with your approval).

```
/plugin marketplace add alifurkangokce/driftlint
/plugin install driftlint@driftlint
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) — next up: an **optional LLM pass** for narrative claims, then **Reviewed Memory**: agents *propose* knowledge at session end, humans approve via PR, git distributes it, and driftlint keeps it honest.

## License

MIT
