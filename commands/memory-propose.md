---
description: Distill what this session learned about the repo into reviewable team-memory proposals (Reviewed Memory).
---

Distill the durable, repo-specific knowledge from THIS session into team-memory proposals.

1. Review the session and collect facts that (a) are about THIS repository, (b) were verified against code or command output, (c) a teammate's agent would otherwise have to rediscover. Skip generic knowledge, opinions, secrets, and anything already stated in CLAUDE.md/AGENTS.md.
2. For each fact (usually 1–5 per session), run:
   `npx -y @alifurkangokce/driftlint memory propose --text "<one plain-language fact>" --evidence "<file:line or commit sha>" --source "claude-code"`
   Add `--scope <dir/>` when the fact only applies to part of the repo.
3. Show the user the proposed entries and tell them to run `npx -y @alifurkangokce/driftlint memory review` (interactive approve/reject; approving auto-syncs the block into CLAUDE.md/AGENTS.md so every agent CLI picks it up and driftlint keeps verifying it).
4. Never approve on the user's behalf — proposing is the agent's job, approving is the human's.

$ARGUMENTS
