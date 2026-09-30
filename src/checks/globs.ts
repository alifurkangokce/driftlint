import type { ContextFile, Finding } from "../types.js";
import type { WalkEntry } from "../fswalk.js";
import { parseFrontmatter } from "../frontmatter.js";
import { anyFileMatches, splitPatternList } from "../glob.js";

/**
 * A path-scoped rule loads only when the agent touches a matching file. When
 * no file in the repo matches, the rule never loads — and no tool says so. The
 * usual cause is a rule copied from another project (`**\/*.py` in a TS repo),
 * or a directory that was renamed after the rule was written.
 */

interface Scoping {
  /** The frontmatter key this surface scopes by. */
  key: string;
  /** Is the key only honoured under some other setting? */
  active?: (fm: Map<string, string | string[]>) => boolean;
  /** Surfaces documented as resolving from the repo root only. */
  rootOnly?: boolean;
  agent: string;
}

const scalar = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.trim().toLowerCase() ?? "";

function scopingFor(file: string): Scoping | null {
  if (/(^|\/)\.claude\/rules\/.+\.md$/.test(file) || /(^|\/)\.claude\/skills\/.+\/SKILL\.md$/.test(file)) {
    return { key: "paths", agent: "Claude Code" };
  }
  if (/(^|\/)\.cursor\/rules\/.+\.mdc$/.test(file)) {
    // with alwaysApply the globs are moot — the rule loads regardless
    return { key: "globs", agent: "Cursor", active: (fm) => scalar(fm.get("alwaysApply")) !== "true" };
  }
  if (/(^|\/)\.github\/instructions\/.+\.instructions\.md$/.test(file)) {
    return { key: "applyTo", agent: "GitHub Copilot", rootOnly: true };
  }
  if (/(^|\/)\.kiro\/steering\/.+\.md$/.test(file)) {
    return { key: "fileMatchPattern", agent: "Kiro", active: (fm) => scalar(fm.get("inclusion")) === "filematch" };
  }
  if (/(^|\/)\.(windsurf|devin)\/rules\/.+\.md$/.test(file)) {
    return { key: "globs", agent: "Windsurf/Devin", active: (fm) => scalar(fm.get("trigger")) === "glob" };
  }
  return null;
}

/** The project that owns an agent config dir: `sub/.cursor/rules/x.mdc` → `sub`. */
function owningProject(file: string): string {
  const m = /(^|\/)\.(claude|cursor|github|kiro|windsurf|devin)\//.exec(file);
  return m ? file.slice(0, m.index) : "";
}

/** Keys other agents use, written into a Claude rule where only `paths` is read. */
const FOREIGN_SCOPE_KEYS = ["globs", "applyTo", "fileMatchPattern"];

/** When most scoped rules match nothing, the repo is shipping rules for the
 *  projects it generates — one note beats a flood, as with foreign-context. */
const COLLAPSE_MIN = 3;
const COLLAPSE_RATIO = 0.6;

export function checkDeadGlobs(files: ContextFile[], entries: WalkEntry[], skipDirs: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  const dead: Finding[] = [];
  let judged = 0;
  const repoFiles = entries.filter((e) => !e.isDir).map((e) => e.rel);

  for (const file of files) {
    const scoping = scopingFor(file.path);
    if (!scoping) continue;
    const fm = parseFrontmatter(file.lines);
    if (!fm) continue;

    // Claude Code reads exactly one key from a rule and ignores the rest
    // without a word — so a Cursor-style `globs:` leaves the rule UNscoped,
    // loading everywhere: the opposite of what its author asked for.
    if (scoping.key === "paths" && !fm.values.has("paths")) {
      const foreign = FOREIGN_SCOPE_KEYS.find((k) => fm.values.has(k));
      if (foreign) {
        findings.push({
          rule: "silent-config",
          severity: "warning",
          file: file.path,
          line: fm.lines.get(foreign) ?? 0,
          message: `Claude Code reads only \`paths:\` from a rule — \`${foreign}:\` is ignored, so this rule loads for every file instead of the ones it names.`,
          hint: `rename \`${foreign}:\` to \`paths:\` (a YAML list or a comma-separated string).`,
          fix: { oldText: `${foreign}:`, newText: "paths:" },
        });
        continue;
      }
    }

    if (scoping.active && !scoping.active(fm.values)) continue;
    const value = fm.values.get(scoping.key);
    if (value === undefined) continue;
    const globs = (Array.isArray(value) ? value : [value]).flatMap((v) => splitPatternList(v));
    if (globs.length === 0) continue;

    // Build output and dependency trees are never walked, so a glob into them
    // would look dead when it isn't. Abstain rather than guess.
    const firstLiteral = (g: string) => g.replace(/^\.?\/+/, "").split("/")[0] ?? "";
    if (globs.some((g) => skipDirs.has(firstLiteral(g)))) continue;

    const owner = owningProject(file.path);
    const bases = scoping.rootOnly || owner === "" ? [""] : ["", owner];
    const alive = anyFileMatches(globs, repoFiles, bases);
    if (alive === null) continue; // can't interpret: abstain
    judged++;
    if (alive) continue;

    const shown = globs.map((g) => `\`${g}\``).join(", ");
    dead.push({
      rule: "dead-glob",
      severity: "warning",
      file: file.path,
      line: fm.lines.get(scoping.key) ?? 0,
      message: `${scoping.agent} loads this rule only for files matching ${shown} — nothing in the repo does, so it never loads.`,
      hint: owner
        ? `patterns were tried from the repo root and from \`${owner}/\`. A rule copied from another project, or a directory renamed since, is the usual cause.`
        : "a rule copied from another project, or a directory renamed since it was written, is the usual cause.",
    });
  }
  if (dead.length >= COLLAPSE_MIN && dead.length / judged >= COLLAPSE_RATIO) {
    const dirs = [...new Set(dead.map((f) => f.file.slice(0, f.file.lastIndexOf("/"))))];
    findings.push({
      rule: "dead-glob",
      severity: "warning",
      file: dirs[0] ?? (dead[0] as Finding).file,
      line: 0,
      message: `${dead.length} of ${judged} path-scoped rules match no file in this repo, so none of them ever load — this repo probably ships rules for the projects it generates.`,
      hint: `if so, mark them with a "driftlint-template" comment or a "templates" glob in .driftlintrc.json; if not, the globs need updating. Dead: ${dead.map((f) => `\`${f.file.split("/").pop()}\``).join(", ")}.`,
    });
  } else {
    findings.push(...dead);
  }
  return findings;
}
