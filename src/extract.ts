import type { CommandRef, ContextFile, PathRef } from "./types.js";

/**
 * Pull path-looking and command-looking claims out of a markdown context file.
 * Lines carrying a `driftlint-ignore` marker (same line or the line above) are skipped.
 */
export function extractRefs(file: ContextFile): { paths: PathRef[]; commands: CommandRef[] } {
  const paths: PathRef[] = [];
  const commands: CommandRef[] = [];
  const seenPath = new Set<string>();
  const seenCmd = new Set<string>();

  let inFence = false;
  for (let i = 0; i < file.lines.length; i++) {
    const line = file.lines[i] ?? "";
    const prev = i > 0 ? file.lines[i - 1] ?? "" : "";
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (line.includes("driftlint-ignore") || prev.includes("driftlint-ignore")) continue;

    // --- commands ---
    // Only look inside code spans/fences — prose like "make informed decisions"
    // or a mentioned script name in a sentence is not a command claim.
    const codeText = inFence
      ? line
      : [...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).join("  ");
    // `cd server && yarn develop` scopes the command to server/ — capture it
    const cwdMatch = /\bcd\s+([A-Za-z0-9_./-]+)\s*(?:&&|;)/.exec(codeText);
    const cwd = cwdMatch?.[1];
    for (const m of codeText.matchAll(/\b(?:npm|pnpm|bun)\s+run\s+([A-Za-z0-9:_.-]+)/g)) {
      const name = m[1];
      if (name && !seenCmd.has(`npm:${name}:${i}`)) {
        seenCmd.add(`npm:${name}:${i}`);
        commands.push({ kind: "npm-script", name, line: i + 1, ...(cwd ? { cwd } : {}) });
      }
    }
    for (const m of codeText.matchAll(/\byarn\s+(?:run\s+)?([A-Za-z0-9:_.-]+)/g)) {
      const name = m[1];
      // `yarn foo` is shorthand for a script, but it is also how every yarn
      // built-in is invoked — reporting those as missing scripts fails a yarn
      // repo on its first run. Ambiguous names (publish, version) stay out:
      // a missed finding beats a false error.
      const builtins = YARN_BUILTINS;
      if (name && !builtins.has(name) && !seenCmd.has(`npm:${name}:${i}`)) {
        seenCmd.add(`npm:${name}:${i}`);
        commands.push({ kind: "npm-script", name, line: i + 1, ...(cwd ? { cwd } : {}) });
      }
    }
    for (const m of codeText.matchAll(/\bmake\s+([A-Za-z0-9_.-]+)/g)) {
      const name = m[1];
      if (name && !name.startsWith("-") && !seenCmd.has(`make:${name}:${i}`)) {
        seenCmd.add(`make:${name}:${i}`);
        commands.push({ kind: "make-target", name, line: i + 1, ...(cwd ? { cwd } : {}) });
      }
    }

    // --- paths ---
    // Tree-diagram lines (├── page/) carry entries relative to their parent
    // entry, which we don't reconstruct — skip them to avoid false positives.
    if (/[│├└╰]|(^\s*(\|--|`--))/.test(line)) continue;

    // "Example: src/foo.ts" / "(e.g. `config.ts`)" lines are illustrations, not claims
    if (/^\s*[-*>#]*\s*\**example/i.test(line) || /\be\.g\.|\(e\.g/i.test(line)) continue;

    // Candidates come from inline code spans and, inside fences, whole-line tokens.
    const candidates: string[] = [];
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      if (m[1]) candidates.push(m[1]);
    }
    if (inFence) {
      for (const tok of line.split(/[\s"'()]+/)) {
        // bare `dirname/` inside a fence is almost always an indented tree
        // listing entry, relative to a parent line we don't reconstruct
        if (/^[^/]+\/$/.test(tok)) continue;
        candidates.push(tok);
      }
    }

    for (const raw of candidates) {
      const cleaned = cleanToken(raw);
      if (!cleaned) continue;
      if (!looksLikePath(cleaned)) continue;
      const key = `${cleaned}:${i}`;
      if (seenPath.has(key)) continue;
      seenPath.add(key);
      paths.push({ raw: cleaned, line: i + 1 });
    }
  }
  return { paths, commands };
}

const YARN_BUILTINS = new Set([
  "install", "add", "remove", "init", "dlx", "create", "up", "why", "info",
  "workspaces", "workspace", "audit", "outdated", "upgrade", "upgrade-interactive",
  "cache", "config", "dedupe", "exec", "explain", "global", "licenses", "link",
  "unlink", "list", "node", "npm", "pack", "patch", "patch-commit", "plugin",
  "publish", "rebuild", "set", "stage", "unplug", "version", "versions", "bin",
  "constraints", "import", "policies", "autoclean", "login", "logout", "owner",
  "tag", "team", "help", "search", "generate-lock-entry",
]);

export interface LinkRef {
  /** Link target path, "" for a same-file `#anchor` link. */
  target: string;
  anchor?: string;
  line: number;
  /** Lines whose reference-style usages activated this definition. */
  usageLines?: number[];
  /** Reference definitions are reported but not auto-fixed ambiguously. */
  isReference?: boolean;
}

const INLINE_LINK = /!?\[[^\]]*\]\(([^()\s]+(?:\s+"[^"]*")?)\)/g;
const REFERENCE_DEFINITION = /^\s{0,3}\[([^\]\n]+)\]:\s*(<[^>\n]*>|\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;
const REFERENCE_USAGE = /(?<![\\!])!?\[([^\]\n]*)\]\[([^\]\n]*)\]/g;

/** Markdown link/image targets that point inside the repo — `[x](docs/a.md#setup)`. */
export function extractLinks(file: ContextFile): LinkRef[] {
  const links: LinkRef[] = [];
  const definitions = collectReferenceDefinitions(file);
  const referenceUsages = new Map<string, Set<number>>();
  let inFence = false;
  for (let i = 0; i < file.lines.length; i++) {
    const line = file.lines[i] ?? "";
    const prev = i > 0 ? file.lines[i - 1] ?? "" : "";
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.includes("driftlint-ignore") || prev.includes("driftlint-ignore")) continue;

    if (REFERENCE_DEFINITION.test(line)) continue;

    for (const m of line.matchAll(INLINE_LINK)) {
      const link = parseLinkTarget(m[1] ?? "", i + 1);
      if (link) links.push(link);
    }

    // Full and collapsed references only. Shortcut references (`[label]`) are
    // intentionally excluded: without a markdown parser they collide with
    // bracketed prose, footnotes, task markers, and code-span examples.
    const referenceText = line.replace(INLINE_LINK, (link) => " ".repeat(link.length));
    for (const m of referenceText.matchAll(REFERENCE_USAGE)) {
      const label = normalizeReferenceLabel(m[2] || m[1] || "");
      const definition = definitions.get(label);
      if (!definition) continue;
      const usageLines = referenceUsages.get(label) ?? new Set<number>();
      usageLines.add(i + 1);
      referenceUsages.set(label, usageLines);
    }
  }

  for (const [label, usageLines] of referenceUsages) {
    const definition = definitions.get(label);
    if (definition) links.push({ ...definition, usageLines: [...usageLines], isReference: true });
  }
  links.sort((a, b) => a.line - b.line);
  return links;
}

/** Collect eligible definitions first so usages can precede them. */
function collectReferenceDefinitions(file: ContextFile): Map<string, LinkRef | null> {
  const definitions = new Map<string, LinkRef | null>();
  let inFence = false;
  for (let i = 0; i < file.lines.length; i++) {
    const line = file.lines[i] ?? "";
    const prev = i > 0 ? file.lines[i - 1] ?? "" : "";
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.includes("driftlint-ignore") || prev.includes("driftlint-ignore")) continue;

    const m = REFERENCE_DEFINITION.exec(line);
    if (!m?.[1] || !m[2]) continue;
    const label = normalizeReferenceLabel(m[1]);
    if (!label || definitions.has(label)) continue; // first definition wins
    definitions.set(label, parseLinkTarget(m[2], i + 1));
  }
  return definitions;
}

function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toUpperCase().toLowerCase();
}

function parseLinkTarget(
  raw: string,
  line: number,
): LinkRef | null {
  let targetWithAnchor = raw.replace(/\s+"[^"]*"$/, "").replace(/^<|>$/g, "");
  try {
    targetWithAnchor = decodeURI(targetWithAnchor);
  } catch {
    return null;
  }
  // External, site-absolute, and templated targets aren't repo claims.
  if (
    !targetWithAnchor ||
    /^[a-z][a-z0-9+.-]*:/i.test(targetWithAnchor) ||
    targetWithAnchor.startsWith("//") ||
    targetWithAnchor.startsWith("/") ||
    targetWithAnchor.startsWith("~")
  ) return null;
  if (/[<>{}$*|`\\]/.test(targetWithAnchor)) return null;
  const hash = targetWithAnchor.indexOf("#");
  const beforeHash = hash === -1 ? targetWithAnchor : targetWithAnchor.slice(0, hash);
  const anchor = hash === -1 ? undefined : targetWithAnchor.slice(hash + 1).trim();
  // `?plain=1`, `?raw=true`, `?utm_source=…` are view/tracking parameters on a
  // real file, not part of its name
  const query = beforeHash.indexOf("?");
  const target = query === -1 ? beforeHash : beforeHash.slice(0, query);
  if (!target && !anchor) return null;
  if (/(^|\/)path\/to(\/|$)/.test(target)) return null;
  return { target, ...(anchor ? { anchor } : {}), line };
}

function cleanToken(raw: string): string | null {
  let s = raw.trim();
  if (!s || s.length > 200) return null;
  // strip trailing prose punctuation and :line[:col] / :start-end suffixes
  s = s.replace(/[.,;!?]+$/, "");
  s = s.replace(/:\d+(?:[-–:]\d+)*$/, "");
  if (!s) return null;
  return s;
}

/** Extensions we accept for BARE tokens (no slash) — keeps `console.log`, `i.Id`, `.csx` prose out. */
const BARE_FILE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc", "md", "mdx", "mdc",
  "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "lock",
  "py", "rb", "go", "rs", "java", "kt", "cs", "csx", "fs", "swift", "php",
  "cpp", "cc", "c", "h", "hpp", "sh", "bash", "zsh", "ps1", "bat",
  "sql", "html", "css", "scss", "less", "xml", "csv", "proto", "tf", "http",
]);

/** Framework names that pattern-match as filenames but never are. */
const WELL_KNOWN_TECH = new Set([
  "next.js", "node.js", "vue.js", "react.js", "three.js", "d3.js",
  "express.js", "nest.js", "nuxt.js", "angular.js", "ember.js", "alpine.js",
  "chart.js", "moment.js", "socket.io", "discord.js", "pdf.js", "video.js",
  "p5.js", "obsidian.md",
]);

function looksLikePath(s: string): boolean {
  if (/\s/.test(s)) return false;
  if (s.includes("://") || s.startsWith("mailto:")) return false;
  if (WELL_KNOWN_TECH.has(s.toLowerCase())) return false;
  // *.local.* files are gitignored-by-convention — absence is not drift
  if (/\.local\.[A-Za-z0-9]+$/.test(s)) return false;
  // Windows drive paths / backslash paths describe someone's machine, not the repo
  if (/^[A-Za-z]:[\\/]/.test(s) || s.includes("\\")) return false;
  // URI-scheme tokens (file:./db, sqlite://...) are config values, not path claims
  if (/^[a-z][a-z0-9+.-]*:/.test(s)) return false;
  // .env files are gitignored-by-convention
  if (s === ".env" || s.endsWith("/.env") || /\.env\.[A-Za-z]+$/.test(s)) return false;
  // globs, placeholders, expressions, flags
  if (/[*?<>{}$()[\]|=]/.test(s)) return false;
  if (s.startsWith("-") || s.startsWith("#") || s.startsWith("@")) return false;
  if (!/[A-Za-z]/.test(s)) return false;

  const hasSlash = s.includes("/");
  // bare dot-tokens are extension mentions (`.csx`) or member access (`.Where`), never path claims
  if (!hasSlash && s.startsWith(".")) return false;

  const base = s.split("/").pop() ?? "";
  const extMatch = /\.([A-Za-z0-9]{1,8})$/.exec(base);
  const ext = extMatch?.[1] ?? null;
  const hasExt = ext !== null && !/^\d+\.\d+/.test(base);

  if (hasSlash && (hasExt || s.endsWith("/"))) return true;
  if (hasSlash && /^(\.{1,2}|src|lib|app|test|tests|docs|scripts|packages|config|\.claude|\.cursor|\.github|\.opencode)(\/|$)/.test(s)) return true;
  // bare filenames: only with a known file extension, and never uppercase-first
  // pseudo-extensions like `InstanceTransition.Body` (verified against the repo index later)
  if (!hasSlash && hasExt && ext && BARE_FILE_EXTS.has(ext.toLowerCase()) && !/^[A-Z]/.test(ext) && !isVersionish(s)) {
    return true;
  }
  return false;
}

function isVersionish(s: string): boolean {
  return /^v?\d+(\.\d+)+$/.test(s);
}
