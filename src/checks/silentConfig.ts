import type { Finding } from "../types.js";
import type { WalkEntry } from "../fswalk.js";

/**
 * Config in the wrong shape or the wrong place. Agent CLIs don't error on
 * these — they load nothing and say nothing, which is the worst failure mode
 * for an instruction file: you believe the agent read your rules, it never saw
 * them. Rules here are grounded in the vendors' own documentation.
 */
export function checkSilentConfig(entries: WalkEntry[]): Finding[] {
  const findings: Finding[] = [];

  for (const e of entries) {
    if (e.isDir) continue;

    // Cursor: project rules must be .mdc — a plain .md has nowhere to carry the
    // description/globs/alwaysApply frontmatter, so the rules system skips it.
    // a README there documents the rules for humans; it was never meant to load
    if (/(^|\/)\.cursor\/rules\/.+\.md$/.test(e.rel) && !/(^|\/)(README|CONTRIBUTING)\.md$/i.test(e.rel)) {
      findings.push({
        rule: "silent-config",
        severity: "error",
        file: e.rel,
        line: 0,
        message: "Cursor ignores plain `.md` files under `.cursor/rules` — this rule never loads.",
        hint: "rename it to `.mdc` and add frontmatter (`description`, `globs`, `alwaysApply`); a plain `.md` has no place to declare them.",
      });
      continue;
    }

    // Claude Code skills are directories: .claude/skills/<name>/SKILL.md.
    // A bare markdown file at that level is never picked up.
    const skill = /(^|\/)\.claude\/skills\/([^/]+)\.md$/.exec(e.rel);
    if (skill?.[2] && skill[2] !== "SKILL") {
      findings.push({
        rule: "silent-config",
        severity: "warning",
        file: e.rel,
        line: 0,
        message: "a skill must live at `.claude/skills/<name>/SKILL.md` — a bare `.md` at this level is never loaded.",
        hint: `move it to \`.claude/skills/${skill[2]}/SKILL.md\` (or to \`.claude/commands/\` if it is meant to be a slash command).`,
      });
    }
  }

  return findings;
}
