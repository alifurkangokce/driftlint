/**
 * The small slice of YAML that rule frontmatter actually uses — scalars,
 * inline lists and dash lists. Anything fancier comes back as absent rather
 * than guessed at: every caller treats "can't read it" as "don't report".
 */

export interface Frontmatter {
  /** Key -> scalar or list value. */
  values: Map<string, string | string[]>;
  /** Key -> 1-based line number, for pointing a finding at the right line. */
  lines: Map<string, number>;
}

const unquote = (v: string): string => {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
};

/** Split an inline `[a, "b, c", d]` list without breaking inside quotes. */
function splitInlineList(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      out.push(unquote(cur));
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(unquote(cur));
  return out.filter((x) => x.length > 0);
}

export function parseFrontmatter(lines: string[]): Frontmatter | null {
  if (lines[0]?.trim() !== "---") return null;
  const values = new Map<string, string | string[]>();
  const keyLines = new Map<string, number>();
  let listKey: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "---") return { values, lines: keyLines };
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      const prev = values.get(listKey);
      const list = Array.isArray(prev) ? prev : [];
      list.push(unquote(item[1] ?? ""));
      values.set(listKey, list);
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(raw);
    if (!kv) {
      listKey = null;
      continue;
    }
    const key = kv[1] ?? "";
    const value = (kv[2] ?? "").trim();
    keyLines.set(key, i + 1);
    if (value === "") {
      listKey = key;
      values.set(key, []);
    } else if (value.startsWith("[") && value.endsWith("]")) {
      listKey = null;
      values.set(key, splitInlineList(value.slice(1, -1)));
    } else {
      listKey = null;
      values.set(key, unquote(value));
    }
  }
  return null; // unterminated frontmatter is not frontmatter
}
