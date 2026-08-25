import * as path from "node:path";
import type { CommandRef, ContextFile, Finding } from "../types.js";
import { buildTwinsBlock, findTwinsBlock, stripGeneratedBlocks } from "../twins.js";

/**
 * CLAUDE.md + AGENTS.md in the same directory are twins: most teams keep both
 * because Claude Code only reads the first and Codex/Amp/Cursor read the
 * second (anthropics/claude-code#6235 — 5,200+ 👍, marked "not planned").
 * The predictable failure: someone fixes a command in one file, the twin goes
 * stale, and half the team's agents follow the outdated copy.
 */

export interface TwinInput {
  file: ContextFile;
  commands: CommandRef[];
}

/** Near-duplicate detection: share of the smaller file's lines found in the other. */
const NEAR_DUP_OVERLAP = 0.5;
const MAX_EXAMPLES = 2;

export function checkTwinDrift(inputs: TwinInput[]): Finding[] {
  const byDir = new Map<string, { claude?: TwinInput; agents?: TwinInput }>();
  for (const t of inputs) {
    const base = path.posix.basename(t.file.path);
    if (base !== "CLAUDE.md" && base !== "AGENTS.md") continue;
    const dir = path.posix.dirname(t.file.path);
    const slot = byDir.get(dir) ?? {};
    if (base === "CLAUDE.md") slot.claude = t;
    else slot.agents = t;
    byDir.set(dir, slot);
  }

  const findings: Finding[] = [];
  for (const pair of byDir.values()) {
    if (pair.claude && pair.agents) findings.push(...checkPair(pair.claude, pair.agents));
  }
  return findings;
}

function checkPair(claude: TwinInput, agents: TwinInput): Finding[] {
  // bridged by an @import: Claude Code inlines `@AGENTS.md`, so the pair
  // shares one source of truth — nothing to compare
  if (/(^|[\s(])@\.?\/?AGENTS\.md\b/.test(claude.file.content)) return [];
  if (/(^|[\s(])@\.?\/?CLAUDE\.md\b/.test(agents.file.content)) return [];

  // bridged by a driftlint-twins mirror block: verify it against the source
  for (const [mirror, source] of [
    [claude, agents],
    [agents, claude],
  ] as const) {
    const span = findTwinsBlock(mirror.file.content);
    if (!span) continue;
    const expected = buildTwinsBlock(path.posix.basename(source.file.path), source.file.content);
    const current = mirror.file.content.slice(span.start, span.end);
    if (current === expected) return [];
    const line = mirror.file.content.slice(0, span.start).split("\n").length;
    return [
      {
        rule: "twin-drift",
        severity: "error",
        file: mirror.file.path,
        line,
        message: `the driftlint-twins block is stale — ${path.posix.basename(source.file.path)} changed after the last mirror.`,
        hint: "run `driftlint twins` to re-sync (add `driftlint twins --check` to CI to catch this before merge).",
      },
    ];
  }

  // unbridged pair: flag only when there is evidence of drift, not mere difference
  const clauses: string[] = [];

  const cmdSet = (t: TwinInput) => new Set(t.commands.map((c) => `${c.kind}:${c.name}`));
  const cmdA = cmdSet(claude);
  const cmdB = cmdSet(agents);
  const cmdOnlyA = [...cmdA].filter((c) => !cmdB.has(c));
  const cmdOnlyB = [...cmdB].filter((c) => !cmdA.has(c));
  if (cmdA.size > 0 && cmdB.size > 0 && (cmdOnlyA.length > 0 || cmdOnlyB.length > 0)) {
    const show = (list: string[], name: string) =>
      list.length
        ? `\`${list.slice(0, MAX_EXAMPLES).map((c) => c.split(":")[1]).join("\`, \`")}\`${list.length > MAX_EXAMPLES ? ` +${list.length - MAX_EXAMPLES}` : ""} only in ${name}`
        : "";
    clauses.push(
      ["command claims differ: ", [show(cmdOnlyA, "CLAUDE.md"), show(cmdOnlyB, "AGENTS.md")].filter(Boolean).join("; ")].join(""),
    );
  }

  const lineSet = (t: TwinInput) =>
    new Set(
      stripGeneratedBlocks(t.file.content)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 3),
    );
  const linesA = lineSet(claude);
  const linesB = lineSet(agents);
  if (linesA.size > 0 && linesB.size > 0) {
    const shared = [...linesA].filter((l) => linesB.has(l)).length;
    const overlap = shared / Math.min(linesA.size, linesB.size);
    const diff = [...linesA].filter((l) => !linesB.has(l)).length + [...linesB].filter((l) => !linesA.has(l)).length;
    if (overlap >= NEAR_DUP_OVERLAP && overlap < 1 && diff > 0) {
      clauses.push(`the files are ${Math.round(overlap * 100)}% identical but ${diff} line${diff === 1 ? "" : "s"} differ`);
    }
  }

  if (clauses.length === 0) return [];
  return [
    {
      rule: "twin-drift",
      severity: "warning",
      file: claude.file.path,
      line: 0,
      message: `CLAUDE.md and AGENTS.md have drifted apart — ${clauses.join("; ")}.`,
      hint: "pick one source of truth: add an `@AGENTS.md` import to CLAUDE.md (Claude Code inlines it), or mirror with `driftlint twins` and guard with `driftlint twins --check` in CI.",
    },
  ];
}
