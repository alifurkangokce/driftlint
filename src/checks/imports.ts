import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextFile, Finding, RepoIndex } from "../types.js";

/**
 * `@path` imports, as Claude Code documents them: expanded at launch, resolved
 * relative to the importing file, followed at most four hops deep, skipped
 * inside code spans and fences. A dead import loads nothing and says nothing —
 * the instruction its author meant to include simply isn't there.
 */

const MAX_HOPS = 4;

/** Files that expand `@path` imports when an agent loads them. */
const IMPORTING_KINDS = new Set(["claude-md", "agents-md", "gemini"]);

/** Something that looks like a file, not a mention, a package or a version. */
const HAS_EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const VERSION_LIKE = /^v?\d+(\.\d+)+$/;

export interface ImportRef {
  /** The path as written, backslash-escaped spaces included. */
  raw: string;
  /** The path it resolves to relative to the importing file. */
  target: string;
  line: number;
  /** 1-based column of `raw` (after the `@`). */
  column: number;
}

/** Imports in one markdown file, outside fences, code spans, comments and frontmatter. */
export function extractImports(lines: string[]): ImportRef[] {
  const out: ImportRef[] = [];
  let inFence = false;
  let inComment = false;
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // blank out code spans and HTML comments, keeping columns stable
    let text = line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
    if (inComment) {
      const close = text.indexOf("-->");
      if (close === -1) continue;
      text = " ".repeat(close + 3) + text.slice(close + 3);
      inComment = false;
    }
    text = text.replace(/<!--.*?-->/g, (m) => " ".repeat(m.length));
    const open = text.indexOf("<!--");
    if (open !== -1) {
      text = text.slice(0, open);
      inComment = true;
    }
    for (const m of text.matchAll(/(^|[\s(\[])@((?:\\ |[^\s`"'<>()[\]])+)/g)) {
      const raw = (m[2] ?? "").replace(/[.,;:!?]+$/, "");
      if (!raw || raw.startsWith("~") || raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) continue;
      const target = raw.replace(/\\ /g, " ");
      out.push({ raw, target, line: i + 1, column: (m.index ?? 0) + (m[1]?.length ?? 0) + 2 });
    }
  }
  return out;
}

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

export function checkImports(files: ContextFile[], index: RepoIndex): Finding[] {
  const root = path.resolve(index.root);
  const findings: Finding[] = [];
  const reported = new Set<string>();
  const report = (f: Finding) => {
    const key = `${f.file}|${f.line}|${f.message}`;
    if (!reported.has(key)) {
      reported.add(key);
      findings.push(f);
    }
  };

  // shallowest depth each file is reached at; BFS makes the first visit shallowest
  const depthOf = new Map<string, number>();
  const queue: Array<{ rel: string; depth: number; origin: string }> = [];
  for (const f of files) {
    if (!IMPORTING_KINDS.has(f.kind)) continue;
    depthOf.set(f.path, 0);
    queue.push({ rel: f.path, depth: 0, origin: f.path });
  }

  while (queue.length > 0) {
    const { rel, depth, origin } = queue.shift() as (typeof queue)[number];
    let lines: string[];
    try {
      lines = fs.readFileSync(path.join(root, rel), "utf8").split(/\r?\n/);
    } catch {
      continue;
    }
    const dir = path.posix.dirname(rel);
    for (const imp of extractImports(lines)) {
      const targetRel = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, imp.target));
      // outside the repo, it's someone's machine-specific file — not ours to judge
      if (targetRel.startsWith("../") || targetRel === "..") continue;
      const abs = path.join(root, targetRel);
      const exists = isFile(abs);

      if (!exists) {
        const base = path.posix.basename(imp.target);
        // only a path-shaped token is a claim; `@alice` and `@types/node` are not
        if (!HAS_EXTENSION.test(base) || VERSION_LIKE.test(base)) continue;
        const candidates = (index.basenames.get(base) ?? []).filter((c) => isFile(path.join(root, c)));
        const single = candidates.length === 1 ? candidates[0] : undefined;
        const suggestion = single ? path.posix.relative(dir === "." ? "" : dir, single) : undefined;
        report({
          rule: "dead-import",
          severity: "error",
          file: rel,
          line: imp.line,
          message: `\`@${imp.raw}\` imports a file that does not exist — Claude Code loads nothing in its place, and says nothing.`,
          ...(candidates.length
            ? { hint: `did you mean ${candidates.slice(0, 3).map((c) => `\`${c}\``).join(", ")}? Imports resolve relative to the importing file.` }
            : { hint: "imports resolve relative to the file that contains them, not the working directory." }),
          ...(suggestion ? { fix: { oldText: imp.raw, newText: suggestion.replace(/ /g, "\\ "), column: imp.column } } : {}),
        });
        continue;
      }

      const next = depth + 1;
      if (next > MAX_HOPS) {
        report({
          rule: "dead-import",
          severity: "warning",
          file: rel,
          line: imp.line,
          message: `\`@${imp.raw}\` is ${next} imports deep from \`${origin}\` — Claude Code follows imports ${MAX_HOPS} hops and stops, so this file never loads.`,
          hint: "import it from a file closer to the root, or inline what it says.",
        });
        continue;
      }
      // only markdown carries further imports; a JSON file's "@types/node" is not one
      if (!/\.(md|mdx|markdown|txt)$/i.test(targetRel)) continue;
      const seen = depthOf.get(targetRel);
      if (seen !== undefined && seen <= next) continue;
      depthOf.set(targetRel, next);
      queue.push({ rel: targetRel, depth: next, origin });
    }
  }
  return findings;
}
