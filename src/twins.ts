import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Twins: CLAUDE.md and AGENTS.md carrying the same instructions.
 * Claude Code reads only CLAUDE.md (anthropics/claude-code#6235, marked
 * "not planned"), Codex/Amp/Cursor read AGENTS.md — so teams keep both, and
 * the copies drift. `driftlint twins` mirrors one into the other as a marked
 * block; `--check` fails CI when the mirror is stale; the `twin-drift` rule
 * flags unbridged pairs that have already diverged.
 */

export const TWINS_START_PREFIX = "<!-- driftlint-twins:start";
export const TWINS_END = "<!-- driftlint-twins:end -->";
const MEMORY_START_PREFIX = "<!-- driftlint-memory:start";
const MEMORY_END = "<!-- driftlint-memory:end -->";

const PAIR = ["AGENTS.md", "CLAUDE.md"] as const;
export type TwinName = (typeof PAIR)[number];

/** Remove driftlint-generated marker blocks so a mirror never nests them. */
export function stripGeneratedBlocks(content: string): string {
  let out = content;
  for (const [startPrefix, end] of [
    [TWINS_START_PREFIX, TWINS_END],
    [MEMORY_START_PREFIX, MEMORY_END],
  ] as const) {
    const s = out.indexOf(startPrefix);
    const e = out.indexOf(end, s);
    if (s !== -1 && e !== -1) out = out.slice(0, s) + out.slice(e + end.length);
  }
  return out;
}

export function buildTwinsBlock(sourceName: string, sourceContent: string): string {
  const payload = stripGeneratedBlocks(sourceContent).trim();
  return `${TWINS_START_PREFIX} — mirrored from ${sourceName} by \`driftlint twins\`; edit ${sourceName}, not this block -->\n${payload}\n${TWINS_END}`;
}

/** The [start, endExclusive) span of the twins block, or null. */
export function findTwinsBlock(content: string): { start: number; end: number } | null {
  const s = content.indexOf(TWINS_START_PREFIX);
  if (s === -1) return null;
  const e = content.indexOf(TWINS_END, s);
  if (e === -1) return null;
  return { start: s, end: e + TWINS_END.length };
}

export interface TwinsResult {
  source: TwinName;
  target: TwinName;
  action: "created" | "updated" | "unchanged";
}

export interface TwinsCheck {
  ok: boolean;
  source: TwinName;
  target: TwinName;
  reason?: "target-missing" | "no-block" | "stale";
}

function resolvePair(dir: string, sourceFlag?: string): { source: TwinName; target: TwinName } {
  if (sourceFlag) {
    const name = path.basename(sourceFlag);
    if (!PAIR.includes(name as TwinName)) {
      throw new Error(`--source must be one of ${PAIR.join(", ")}`);
    }
    const source = name as TwinName;
    return { source, target: source === "AGENTS.md" ? "CLAUDE.md" : "AGENTS.md" };
  }
  // AGENTS.md is the cross-tool standard — default source of truth
  for (const source of PAIR) {
    if (fs.existsSync(path.join(dir, source))) {
      return { source, target: source === "AGENTS.md" ? "CLAUDE.md" : "AGENTS.md" };
    }
  }
  throw new Error(`neither AGENTS.md nor CLAUDE.md exists in ${dir}`);
}

export function checkTwins(dir: string, opts: { source?: string } = {}): TwinsCheck {
  const { source, target } = resolvePair(dir, opts.source);
  const sourcePath = path.join(dir, source);
  if (!fs.existsSync(sourcePath)) throw new Error(`${source} does not exist in ${dir}`);
  const expected = buildTwinsBlock(source, fs.readFileSync(sourcePath, "utf8"));

  const targetPath = path.join(dir, target);
  if (!fs.existsSync(targetPath)) return { ok: false, source, target, reason: "target-missing" };
  const content = fs.readFileSync(targetPath, "utf8");
  const span = findTwinsBlock(content);
  if (!span) return { ok: false, source, target, reason: "no-block" };
  const current = content.slice(span.start, span.end);
  return current === expected
    ? { ok: true, source, target }
    : { ok: false, source, target, reason: "stale" };
}

export function syncTwins(dir: string, opts: { source?: string } = {}): TwinsResult {
  const { source, target } = resolvePair(dir, opts.source);
  const sourcePath = path.join(dir, source);
  if (!fs.existsSync(sourcePath)) throw new Error(`${source} does not exist in ${dir}`);
  const block = buildTwinsBlock(source, fs.readFileSync(sourcePath, "utf8"));

  const targetPath = path.join(dir, target);
  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, `${block}\n`);
    return { source, target, action: "created" };
  }
  const content = fs.readFileSync(targetPath, "utf8");
  const span = findTwinsBlock(content);
  const next = span
    ? content.slice(0, span.start) + block + content.slice(span.end)
    : `${content.replace(/\n*$/, "")}\n\n${block}\n`;
  if (next === content) return { source, target, action: "unchanged" };
  fs.writeFileSync(targetPath, next);
  return { source, target, action: "updated" };
}

export function runTwinsCli(argv: string[]): number {
  let dir = process.cwd();
  let source: string | undefined;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") check = true;
    else if (a === "--source") {
      source = argv[++i];
      if (!source || source.startsWith("-")) {
        console.error("driftlint twins: --source expects AGENTS.md or CLAUDE.md");
        return 2;
      }
    } else if (a && !a.startsWith("-")) dir = path.resolve(a);
    else {
      console.error(`driftlint twins [dir] [--source AGENTS.md|CLAUDE.md] [--check]
  mirrors the source file into its twin as a marked block (idempotent);
  --check exits 1 when the mirror is missing or stale (CI mode).`);
      return 2;
    }
  }

  try {
    if (check) {
      const r = checkTwins(dir, { source });
      if (r.ok) {
        console.log(`driftlint twins: ${r.target} mirror of ${r.source} is up to date`);
        return 0;
      }
      const why =
        r.reason === "target-missing"
          ? `${r.target} does not exist`
          : r.reason === "no-block"
            ? `${r.target} has no driftlint-twins block`
            : `${r.target} mirror is stale`;
      console.error(`driftlint twins --check: ${why} — run \`driftlint twins\` to sync from ${r.source}`);
      return 1;
    }
    const r = syncTwins(dir, { source });
    console.log(`driftlint twins: ${r.target} ${r.action} (mirrored from ${r.source})`);
    return 0;
  } catch (e) {
    console.error(`driftlint twins: ${(e as Error).message}`);
    return 2;
  }
}
