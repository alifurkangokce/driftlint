/**
 * Glob matching for rule-scoping frontmatter. Conservative by design: a
 * pattern this can't interpret with confidence yields `null`, and the caller
 * abstains. The only thing worse than missing a dead rule is telling someone a
 * working rule is dead.
 */

/** Expansion ceiling. Claude Code's own budget is 1,000 per rule; past a few
 *  hundred we can't afford to be the thing that is slow, so we stop and abstain. */
const MAX_EXPANSIONS = 256;

/** Split a comma list at brace depth 0, so `src/*.{ts,tsx}, lib/**` stays two patterns. */
export function splitPatternList(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "{") depth++;
    if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((p) => p.replace(/^(["'])(.*)\1$/, "$2"));
}

/** First top-level `{a,b}` group: [start, end, alternatives], "literal" for a
 *  group without a comma, or "invalid" when braces don't balance. */
function braceGroup(p: string): [number, number, string[]] | "none" | "invalid" {
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "\\") {
      i++;
      continue;
    }
    if (p[i] !== "{") continue;
    let depth = 0;
    const alts: string[] = [];
    let cur = "";
    for (let j = i; j < p.length; j++) {
      const ch = p[j];
      if (ch === "{") {
        depth++;
        if (depth === 1) continue;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          alts.push(cur);
          if (alts.length > 1) return [i, j, alts];
          i = j; // `{x}` without a comma is literal braces — keep scanning
          break;
        }
      } else if (ch === "," && depth === 1) {
        alts.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
      if (j === p.length - 1) return "invalid";
    }
  }
  return "none";
}

export function expandBraces(pattern: string): string[] | null {
  const out: string[] = [];
  const stack = [pattern];
  while (stack.length > 0) {
    const p = stack.pop() as string;
    const g = braceGroup(p);
    if (g === "invalid") return null;
    if (g === "none") {
      out.push(p);
    } else {
      const [start, end, alts] = g;
      for (const a of alts) stack.push(p.slice(0, start) + a + p.slice(end + 1));
    }
    if (out.length + stack.length > MAX_EXPANSIONS) return null;
  }
  return out;
}

/** One brace-free glob to an anchored regex, or null when unsupported. */
export function globToRegExp(glob: string): RegExp | null {
  let g = glob.trim();
  if (!g || g.startsWith("!")) return null; // negation: meaning depends on neighbours
  if (/[@!+*?]\(/.test(g)) return null; // extglob
  g = g.replace(/^\.\//, "").replace(/^\/+/, "");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const ch = g[i] as string;
    if (ch === "\\") {
      const next = g[i + 1];
      if (next === undefined) return null;
      re += next.replace(/[.+^${}()|[\]\\*?]/g, "\\$&");
      i++;
    } else if (ch === "*") {
      if (g[i + 1] === "*") {
        const before = i === 0 || g[i - 1] === "/";
        const after = g[i + 2] === "/" || i + 2 === g.length;
        if (!before || !after) return null; // `a**b` has no agreed meaning
        if (g[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (ch === "[") {
      const close = g.indexOf("]", i + 2);
      if (close === -1) return null;
      let cls = g.slice(i + 1, close);
      if (cls.startsWith("!")) cls = `^${cls.slice(1)}`;
      re += `[${cls.replace(/\\/g, "\\\\")}]`;
      i = close;
    } else {
      re += ch.replace(/[.+^${}()|\\]/g, "\\$&");
    }
  }
  try {
    return new RegExp(`^${re}$`);
  } catch {
    return null;
  }
}

/**
 * Does any file match any of these globs, read relative to any of `bases`?
 * Deliberately generous: a slash-free pattern also matches basenames at any
 * depth, and a pattern also counts when it names a directory with files under
 * it. Returns null when a pattern can't be interpreted — callers must abstain.
 */
export function anyFileMatches(globs: string[], files: string[], bases: string[]): boolean | null {
  const regexes: RegExp[] = [];
  for (const glob of globs) {
    const expanded = expandBraces(glob);
    if (!expanded) return null;
    for (const e of expanded) {
      const exact = globToRegExp(e);
      const under = globToRegExp(`${e.replace(/\/+$/, "")}/**`);
      if (!exact) return null;
      regexes.push(exact);
      if (under) regexes.push(under);
      if (!e.includes("/")) {
        const anyDepth = globToRegExp(`**/${e}`);
        if (anyDepth) regexes.push(anyDepth);
      }
    }
  }
  for (const base of bases) {
    const prefix = base ? `${base.replace(/\/+$/, "")}/` : "";
    for (const f of files) {
      if (prefix && !f.startsWith(prefix)) continue;
      const rel = f.slice(prefix.length);
      if (regexes.some((r) => r.test(rel))) return true;
    }
  }
  return false;
}
