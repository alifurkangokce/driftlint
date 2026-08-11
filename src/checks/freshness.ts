import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextFile, Finding, PathRef } from "../types.js";

const STALE_AGE_DAYS = 90;
const CHURN_THRESHOLD = 30;

/**
 * A context file that hasn't moved in months while the code it describes
 * churned heavily is probably lying by omission.
 */
export function checkFreshness(root: string, file: ContextFile, refs: PathRef[]): Finding[] {
  const lastTs = gitLastCommitTs(root, file.path);
  if (lastTs === null) return [];

  const ageDays = Math.floor((Date.now() / 1000 - lastTs) / 86400);
  if (ageDays < STALE_AGE_DAYS) return [];

  const dirs = referencedTopDirs(root, refs);
  if (dirs.length === 0) return [];

  const churn = gitCommitCountSince(root, lastTs, dirs);
  if (churn === null || churn < CHURN_THRESHOLD) return [];

  return [{
    rule: "stale-knowledge",
    severity: "warning",
    file: file.path,
    line: 0,
    message: `unchanged for ${ageDays} days while ${dirs.join(", ")} received ${churn} commits since.`,
    hint: "re-read this file against the current code; update or delete what no longer holds.",
  }];
}

function referencedTopDirs(root: string, refs: PathRef[]): string[] {
  const dirs = new Set<string>();
  for (const ref of refs) {
    if (!ref.raw.includes("/")) continue;
    const top = ref.raw.replace(/^\.\//, "").split("/")[0];
    if (!top || top.startsWith(".") || top.startsWith("~")) continue;
    if (fs.existsSync(path.join(root, top))) dirs.add(top);
  }
  return [...dirs].slice(0, 8);
}

function gitLastCommitTs(root: string, rel: string): number | null {
  const out = git(root, ["log", "-1", "--format=%ct", "--", rel]);
  if (!out) return null;
  const ts = Number.parseInt(out.trim(), 10);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

function gitCommitCountSince(root: string, ts: number, dirs: string[]): number | null {
  const since = new Date(ts * 1000).toISOString();
  const out = git(root, ["rev-list", "--count", "HEAD", `--since=${since}`, "--", ...dirs]);
  if (!out) return null;
  const n = Number.parseInt(out.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}
