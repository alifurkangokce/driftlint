import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextFile, Finding } from "../types.js";
import { extractImports } from "./imports.js";

/**
 * Which instruction file actually loads. Claude Code reads AGENTS.md since
 * v2.1.277 — but by default only when there is no CLAUDE.md, .claude/CLAUDE.md
 * or CLAUDE.local.md in the working directory or above it. When there is one,
 * every AGENTS.md at or below it is skipped, and nothing says so.
 * https://code.claude.com/docs/en/memory#when-claude-code-reads-agents-md
 */

const CLAUDE_FAMILY = /(^|\/)(\.claude\/)?CLAUDE(\.local)?\.md$/;
const READ_IN_WORDS = /\b(read|see|follow|consult|check|refer to|look at|load)\b[^.\n]{0,60}(?<![@/\w.-])(?:\.\/)?AGENTS\.md\b/i;

/** An AGENTS.md in one of these is a payload for something else — a template
 *  a generator copies out, an example project, a container's workspace, a
 *  skill bundle — not instructions for an agent working on this repo. Claude
 *  Code also documents that it never reads anything under `.agents/`. */
const PAYLOAD_SEGMENT = /(^|\/)(\.agents|skills|templates?|template-[^/]+|examples?|samples?|fixtures?|__fixtures__|testdata|scaffolds?|boilerplates?|starters?|docker|\.devcontainer)(\/|$)/i;

/** The directory a CLAUDE-family file governs: `sub/.claude/CLAUDE.md` → `sub`. */
function governs(rel: string): string {
  const dir = path.posix.dirname(rel);
  const d = dir.endsWith("/.claude") ? dir.slice(0, -"/.claude".length) : dir === ".claude" ? "." : dir;
  return d === "." ? "" : d;
}

const dirOf = (rel: string): string => {
  const d = path.posix.dirname(rel);
  return d === "." ? "" : d;
};

/** `a/b` is at or below `a` (and everything is at or below the root). */
const atOrBelow = (dir: string, ancestor: string): boolean =>
  ancestor === "" || dir === ancestor || dir.startsWith(`${ancestor}/`);

/** Lines worth comparing: prose instructions, not headings, fences or rules. */
function substantive(content: string): string[] {
  let fence = false;
  const out: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const t = raw.trim().replace(/^[-*+]\s+|^\d+\.\s+/, "").replace(/\s+/g, " ").toLowerCase();
    if (t.length < 24 || t.startsWith("#") || t.startsWith("<!--") || /^[-=|: ]+$/.test(t)) continue;
    out.push(t);
  }
  return out;
}

export function checkLoadOrder(root: string, files: ContextFile[]): Finding[] {
  const findings: Finding[] = [];
  const claudeFiles = files.filter((f) => f.kind === "claude-md" && CLAUDE_FAMILY.test(f.path));
  const agentsFiles = files.filter((f) => f.kind === "agents-md" && /(^|\/)(\.claude\/)?AGENTS\.md$/.test(f.path));
  if (agentsFiles.length === 0) return findings;

  // AGENTS.md files a CLAUDE-family file pulls in through @imports (≤4 hops)
  const imported = new Set<string>();
  const walkImports = (rel: string, depth: number) => {
    if (depth > 4) return;
    let lines: string[];
    try {
      lines = fs.readFileSync(path.join(root, rel), "utf8").split(/\r?\n/);
    } catch {
      return;
    }
    for (const imp of extractImports(lines)) {
      const target = path.posix.normalize(path.posix.join(dirOf(rel), imp.target));
      if (imported.has(target)) continue;
      imported.add(target);
      if (/\.md$/i.test(target)) walkImports(target, depth + 1);
    }
  };
  for (const c of claudeFiles) walkImports(c.path, 1);

  /** Shadowed files grouped under the CLAUDE.md nearest them, reported together. */
  const hidden = new Map<string, Array<{ agents: ContextFile; missing: number; total: number }>>();

  for (const agents of agentsFiles) {
    if (imported.has(agents.path)) continue;
    const dir = governs(agents.path);
    if (dir && PAYLOAD_SEGMENT.test(dir)) continue;
    const shadows = claudeFiles.filter((c) => atOrBelow(dir, governs(c.path)));
    if (shadows.length === 0) continue; // nothing shadows it: Claude reads it

    // a nested AGENTS.md that a CLAUDE.md names by path is a deliberate
    // on-demand pointer ("see openspec/AGENTS.md for proposals"), not a loss
    if (dir) {
      const named = shadows.some((c) => {
        const rel = path.posix.relative(governs(c.path), agents.path);
        return c.content.includes(rel) || c.content.includes(`/${agents.path}`);
      });
      if (named) continue;
    }

    // a twins mirror carries AGENTS.md's content into CLAUDE.md already
    if (shadows.some((c) => c.content.includes("driftlint-twins:start"))) continue;

    const localOnly = shadows.every((c) => /CLAUDE\.local\.md$/.test(c.path));
    if (localOnly) {
      const local = shadows[0] as ContextFile;
      findings.push({
        rule: "silent-config",
        severity: "warning",
        file: local.path,
        line: 0,
        message: `this \`CLAUDE.local.md\` makes Claude Code skip \`${agents.path}\` on this machine — it counts as a CLAUDE.md, so AGENTS.md is no longer read. Teammates without one still get AGENTS.md; you don't.`,
        hint: "put `@AGENTS.md` on the first line of CLAUDE.local.md, or set Project instructions to `claude-md-and-agents-md` in /config.",
      });
      continue;
    }

    // "Read AGENTS.md first" is a request Claude may or may not act on
    const sameDir = shadows.filter((c) => governs(c.path) === dir);
    let prose: { file: ContextFile; line: number } | null = null;
    for (const c of sameDir) {
      let fence = false;
      c.lines.forEach((l, n) => {
        if (/^\s*(```|~~~)/.test(l)) fence = !fence;
        else if (!fence && !prose && READ_IN_WORDS.test(l.replace(/`/g, ""))) prose = { file: c, line: n + 1 };
      });
    }
    if (prose) {
      const p = prose as { file: ContextFile; line: number };
      findings.push({
        rule: "silent-config",
        severity: "warning",
        file: p.file.path,
        line: p.line,
        message: "this asks Claude to read AGENTS.md in words — Claude Code only sees it if it decides to open the file, because a CLAUDE.md here means AGENTS.md is not loaded.",
        hint: "replace the sentence with an `@AGENTS.md` import (outside backticks) so it loads at launch, every session.",
      });
      continue;
    }

    // Only worth saying when AGENTS.md holds something CLAUDE.md doesn't:
    // two identical copies lose Claude nothing.
    const covered = new Set(shadows.flatMap((c) => substantive(c.content)));
    const lines = substantive(agents.content);
    const missing = lines.filter((l) => !covered.has(l));
    if (missing.length < 3 || missing.length / Math.max(lines.length, 1) < 0.25) continue;

    const nearest = shadows.map((c) => c.path).sort((a, b) => b.length - a.length)[0] as string;
    const group = hidden.get(nearest) ?? [];
    group.push({ agents, missing: missing.length, total: lines.length });
    hidden.set(nearest, group);
  }

  for (const [nearest, group] of hidden) {
    const importLine = (a: ContextFile) => `@${path.posix.relative(dirOf(nearest), a.path)}`;
    const escape = "or — if you set Project instructions to `claude-md-and-agents-md` in /config — ignore this.";
    if (group.length === 1) {
      const { agents, missing, total } = group[0] as (typeof group)[number];
      findings.push({
        rule: "silent-config",
        severity: "warning",
        file: agents.path,
        line: 0,
        message: `Claude Code never reads this file: \`${nearest}\` sits at or above it, and Claude only reads AGENTS.md when there is no CLAUDE.md. ${missing} of its ${total} instruction lines appear in no CLAUDE.md.`,
        hint: `add \`${importLine(agents)}\` to \`${nearest}\`, run \`driftlint twins\`, ${escape}`,
      });
      continue;
    }
    const names = group.map((g) => `\`${g.agents.path}\``).join(", ");
    findings.push({
      rule: "silent-config",
      severity: "warning",
      file: nearest,
      line: 0,
      message: `Claude Code reads none of the ${group.length} AGENTS.md files this CLAUDE.md sits above — it only reads AGENTS.md when there is no CLAUDE.md: ${names}.`,
      hint: `import the ones Claude should see (\`${importLine((group[0] as (typeof group)[number]).agents)}\`, …) from \`${nearest}\`, ${escape}`,
    });
  }
  return findings;
}

/** A SessionStart hook that prints AGENTS.md was the standard workaround for
 *  #6235. Now that Claude reads AGENTS.md itself, it loads a second copy. */
export function checkDoubleLoad(root: string, files: ContextFile[]): Finding[] {
  const rootHasClaude = files.some((f) => f.kind === "claude-md" && governs(f.path) === "" && CLAUDE_FAMILY.test(f.path));
  const rootHasAgents = files.some((f) => f.path === "AGENTS.md");
  if (rootHasClaude || !rootHasAgents) return [];
  const findings: Finding[] = [];
  for (const rel of [".claude/settings.json", ".claude/settings.local.json"]) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      continue;
    }
    const groups = (data as { hooks?: { SessionStart?: Array<{ hooks?: Array<{ command?: string }> }> } })?.hooks?.SessionStart;
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      for (const h of g?.hooks ?? []) {
        if (typeof h?.command !== "string" || !/AGENTS\.md/.test(h.command)) continue;
        if (!/\b(cat|type|Get-Content|head|tail|less|more|sed|awk|printf|echo)\b/.test(h.command)) continue;
        const line = text.split(/\r?\n/).findIndex((l) => l.includes("AGENTS.md")) + 1;
        findings.push({
          rule: "load-budget",
          severity: "info",
          file: rel,
          line,
          message: "this SessionStart hook prints AGENTS.md into every session — Claude Code reads AGENTS.md on its own since v2.1.277, so it now loads twice.",
          hint: "remove the hook; keep it only if some of your sessions run a Claude Code older than v2.1.277.",
        });
      }
    }
  }
  return findings;
}
