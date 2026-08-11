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
    for (const m of line.matchAll(/\b(?:npm|pnpm|bun)\s+run\s+([A-Za-z0-9:_.-]+)/g)) {
      const name = m[1];
      if (name && !seenCmd.has(`npm:${name}:${i}`)) {
        seenCmd.add(`npm:${name}:${i}`);
        commands.push({ kind: "npm-script", name, line: i + 1 });
      }
    }
    for (const m of line.matchAll(/\byarn\s+(?:run\s+)?([A-Za-z0-9:_.-]+)/g)) {
      const name = m[1];
      const builtins = new Set(["install", "add", "remove", "init", "dlx", "create", "up", "why", "info", "workspaces"]);
      if (name && !builtins.has(name) && !seenCmd.has(`npm:${name}:${i}`)) {
        seenCmd.add(`npm:${name}:${i}`);
        commands.push({ kind: "npm-script", name, line: i + 1 });
      }
    }
    for (const m of line.matchAll(/\bmake\s+([A-Za-z0-9_.-]+)/g)) {
      const name = m[1];
      if (name && !name.startsWith("-") && !seenCmd.has(`make:${name}:${i}`)) {
        seenCmd.add(`make:${name}:${i}`);
        commands.push({ kind: "make-target", name, line: i + 1 });
      }
    }

    // --- paths ---
    // Candidates come from inline code spans and, inside fences, whole-line tokens.
    const candidates: string[] = [];
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      if (m[1]) candidates.push(m[1]);
    }
    if (inFence) {
      for (const tok of line.split(/[\s"'()]+/)) candidates.push(tok);
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

function cleanToken(raw: string): string | null {
  let s = raw.trim();
  if (!s || s.length > 200) return null;
  // strip trailing prose punctuation and :line[:col] suffixes
  s = s.replace(/[.,;!?]+$/, "");
  s = s.replace(/:\d+(:\d+)?$/, "");
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

function looksLikePath(s: string): boolean {
  if (/\s/.test(s)) return false;
  if (s.includes("://") || s.startsWith("mailto:")) return false;
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
