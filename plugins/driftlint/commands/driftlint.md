---
description: Scan this repo's agent context files for drift (dead paths, dead commands, invisible skills, stale knowledge) and fix what's found.
---

Run driftlint on the current repository and fix the drift it finds.

1. Run the scanner (an exact version, so what runs is what was reviewed):
   - `npx -y @alifurkangokce/driftlint@0.20.0 --json --no-fail`
   - if that fails, report the error to the user (it needs Node 20+ and access to the npm registry) and stop — do not fall back to an unpinned source.
2. If there are no findings, say so and stop — do not invent work.
3. For each finding, propose a fix in the context file itself (never in the code):
   - `dead-path` with a "did you mean" hint → update the reference to the new path after confirming the hinted file actually matches what the text describes.
   - `dead-path` without a hint → check `git log --diff-filter=D` or search for a successor; if the file is truly gone, rewrite or remove the claim.
   - `dead-command` → replace with the closest existing script/target if it is the same operation; otherwise rewrite the instruction.
   - `skill-budget` → shorten the offending skill descriptions; move detail into the SKILL.md body. Keep the description's trigger keywords.
   - `stale-knowledge` → re-read the flagged file against the current code and update only the claims that no longer hold.
4. Show the user a summary of the proposed edits (file, line, old → new) BEFORE applying them, then apply on approval.
5. Re-run driftlint to confirm the findings are resolved, and report the before/after counts.

$ARGUMENTS
