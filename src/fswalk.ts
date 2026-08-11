import * as fs from "node:fs";
import * as path from "node:path";
import type { RepoIndex } from "./types.js";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", "vendor",
  "venv", ".venv", "__pycache__", ".next", ".nuxt", "target", "bin", "obj",
  ".idea", ".vs", ".vscode-test",
]);

const MAX_DEPTH = 10;
const MAX_ENTRIES = 200_000;

export interface WalkEntry {
  /** Repo-relative path, always with forward slashes. */
  rel: string;
  isDir: boolean;
}

/** Walk the tree once; returns files and directories (ignoring vendored/build dirs). */
export function walk(root: string): WalkEntry[] {
  const entries: WalkEntry[] = [];
  let count = 0;

  const visit = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || count > MAX_ENTRIES) return;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      const abs = path.join(dir, d.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (d.isDirectory()) {
        if (IGNORED_DIRS.has(d.name) || d.name.startsWith(".git")) continue;
        entries.push({ rel, isDir: true });
        count++;
        visit(abs, depth + 1);
      } else if (d.isFile()) {
        entries.push({ rel, isDir: false });
        count++;
      }
    }
  };

  visit(root, 0);
  return entries;
}

/** Build a basename -> paths index so we can suggest "did you mean" for moved files. */
export function buildIndex(root: string, entries: WalkEntry[]): RepoIndex {
  const basenames = new Map<string, string[]>();
  for (const e of entries) {
    const base = e.rel.split("/").pop();
    if (!base) continue;
    const list = basenames.get(base) ?? [];
    if (list.length < 20) list.push(e.rel);
    basenames.set(base, list);
  }
  return { root, basenames };
}
