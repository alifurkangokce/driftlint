import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { ContextFile, Finding } from "../types.js";

/**
 * A context file that git doesn't track is invisible to teammates and CI:
 * agents on this machine follow it, everyone else's agents don't — the
 * quietest way for two developers' agents to disagree.
 */
export function checkUntrackedContext(root: string, files: ContextFile[]): Finding[] {
  const candidates = files.filter(
    // *.local.* context files are personal by convention
    (f) => !/(^|\/)CLAUDE\.local\.md$/.test(f.path),
  );
  if (candidates.length === 0) return [];

  const inRepo = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inRepo === null || !inRepo.startsWith("true")) return [];

  const ls = git(root, ["ls-files", "-z", "--", ...candidates.map((f) => f.path)]);
  if (ls === null) return [];
  const tracked = new Set(ls.split("\0").filter(Boolean));

  const untracked = candidates.filter(
    (f) => !tracked.has(f.path) && !insideNestedRepo(root, f.path),
  );
  if (untracked.length === 0) return [];

  const ignoredOut =
    spawnSync("git", ["-C", root, "check-ignore", "-z", "--stdin"], {
      input: untracked.map((f) => f.path).join("\0"),
      encoding: "utf8",
    }).stdout ?? "";
  const ignored = new Set(ignoredOut.split("\0").filter(Boolean));

  return untracked.map((f) => ({
    rule: "untracked-context",
    severity: "warning",
    file: f.path,
    line: 0,
    message: ignored.has(f.path)
      ? "gitignored — agents on this machine follow it, but teammates and CI never see it."
      : "not committed — agents on this machine follow it, but teammates and CI never see it.",
    hint: ignored.has(f.path)
      ? 'if it is intentionally personal, rename it to CLAUDE.local.md or add it to "ignore" in .driftlintrc.json.'
      : "commit it so every developer's agent works from the same context.",
  }));
}

function git(root: string, args: string[]): string | null {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/** Files inside a nested checkout belong to that repo, not this one. */
function insideNestedRepo(root: string, rel: string): boolean {
  const parts = rel.split("/").slice(0, -1);
  let dir = root;
  for (const p of parts) {
    dir = path.join(dir, p);
    if (fs.existsSync(path.join(dir, ".git"))) return true;
  }
  return false;
}
