import type { ContextFile, Finding } from "../types.js";

/**
 * Claude Code advertises skills to the model through their name + description,
 * inside a system-prompt section with a finite character budget (~15k chars by
 * default; raisable via SLASH_COMMAND_TOOL_CHAR_BUDGET). Skills that fall past
 * the budget are silently invisible — a documented, painful failure mode.
 *
 * This is an estimate: global (~/.claude) and plugin skills also consume the
 * same budget but are outside the scanned repo.
 *
 * On top of the shared budget there is a hard per-skill cut: the combined
 * `description` + `when_to_use` text is truncated at 1,536 characters in the
 * skill listing, so anything past it never reaches the model at all.
 */
const PER_SKILL_OVERHEAD = 40;
const LISTING_CAP = 1_536;

export function checkSkillBudget(skills: ContextFile[], budget: number): Finding[] {
  if (skills.length === 0) return [];
  const findings: Finding[] = [];

  const sized = skills.map((s) => {
    const fm = frontmatter(s.content);
    const name = fm.get("name") ?? s.path;
    const description = fm.get("description") ?? "";
    const whenToUse = fm.get("when_to_use") ?? "";
    const listing = description.length + whenToUse.length;
    return {
      path: s.path,
      name,
      listing,
      chars: name.length + description.length + PER_SKILL_OVERHEAD,
    };
  });

  // hard cut first: this one silently drops text even when the budget is fine
  for (const s of sized) {
    if (s.listing > LISTING_CAP) {
      findings.push({
        rule: "skill-budget",
        severity: "warning",
        file: s.path,
        line: 0,
        message: `skill \`${s.name}\` advertises ${s.listing} chars of description + when_to_use; the skill listing truncates at ${LISTING_CAP}, so the last ${s.listing - LISTING_CAP} never reach the model.`,
        hint: "put the key use case in the first sentence and move the rest into the SKILL.md body, which loads only when the skill runs.",
      });
    }
  }

  const total = sized.reduce((a, s) => a + s.chars, 0);
  if (total <= budget) return findings;

  const over = total - budget;
  const biggest = [...sized].sort((a, b) => b.chars - a.chars).slice(0, 3);
  findings.push({
    rule: "skill-budget",
    severity: "warning",
    file: sized[0]?.path ?? ".claude/skills",
    line: 0,
    message: `repo skills advertise ~${total} chars of name+description; the default system-prompt budget is ~${budget}. Skills past the budget are silently invisible to the agent (~${over} chars over).`,
    hint: `biggest: ${biggest.map((s) => `${s.name} (${s.chars})`).join(", ")}. Note: global and plugin skills consume the same budget on top of this.`,
  });

  for (const s of sized) {
    if (s.chars > 1200) {
      findings.push({
        rule: "skill-budget",
        severity: "info",
        file: s.path,
        line: 0,
        message: `skill \`${s.name}\` spends ${s.chars} chars of the shared budget on its description alone.`,
        hint: "move detail into the SKILL.md body — only name+description are always visible.",
      });
    }
  }
  return findings;
}

function frontmatter(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m || !m[1]) return map;
  let currentKey: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv && kv[1]) {
      currentKey = kv[1].toLowerCase();
      map.set(currentKey, (kv[2] ?? "").trim());
    } else if (currentKey && /^\s+\S/.test(line)) {
      map.set(currentKey, `${map.get(currentKey) ?? ""} ${line.trim()}`);
    }
  }
  return map;
}
