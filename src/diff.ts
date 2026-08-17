import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fingerprint, scan, type ScanOptions } from "./scan.js";
import type { Finding, ScanResult } from "./types.js";

/**
 * PR-diff mode: report only the drift THIS change caused.
 *
 * Deliberately NOT a line filter — the headline finding ("this PR renamed
 * src/auth.ts; CLAUDE.md:42 still references it") lives on a line the diff
 * never touched, so line-based scoping would drop exactly what we exist to
 * catch. Instead: scan the merge-base in a temporary worktree, scan the
 * working tree, and report findings whose fingerprint is new. Renames and
 * deletions from the diff are then attributed onto the new findings.
 */

export interface DiffScanResult extends ScanResult {
  baselineRef: string;
  suppressed: number;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** "A...B" → merge-base(A,B); a single ref → merge-base(ref, HEAD). */
export function resolveBaseline(root: string, range: string): string {
  const [a, b] = range.includes("...") ? range.split("...") : [range, "HEAD"];
  return git(root, ["merge-base", a || "HEAD", b || "HEAD"]);
}

interface RenameMap {
  /** old path → new path for renames */
  renamed: Map<string, string>;
  deleted: Set<string>;
}

function diffNameStatus(root: string, baseline: string): RenameMap {
  const renamed = new Map<string, string>();
  const deleted = new Set<string>();
  try {
    const out = git(root, ["diff", "--name-status", "-M", baseline]);
    for (const line of out.split("\n")) {
      const parts = line.split("\t");
      const status = parts[0] ?? "";
      if (status.startsWith("R") && parts[1] && parts[2]) renamed.set(parts[1], parts[2]);
      else if (status === "D" && parts[1]) deleted.add(parts[1]);
    }
  } catch {
    /* diff unavailable — attribution is best-effort */
  }
  return { renamed, deleted };
}

/** First backtick-quoted token in a finding message is the referenced target. */
function referencedTarget(f: Finding): string | null {
  const m = /`([^`]+)`/.exec(f.message);
  return m?.[1] ?? null;
}

function attribute(findings: Finding[], changes: RenameMap): Finding[] {
  return findings.map((f) => {
    if (f.rule !== "dead-path") return f;
    const target = referencedTarget(f);
    if (!target) return f;
    const cleaned = target.replace(/\/$/, "");
    const renamedTo = changes.renamed.get(cleaned);
    if (renamedTo) {
      return {
        ...f,
        message: `this change renames \`${cleaned}\` → \`${renamedTo}\`, but the context file still references the old path.`,
        hint: `update the reference to \`${renamedTo}\`.`,
        fix: { oldText: target, newText: target.endsWith("/") ? `${renamedTo}/` : renamedTo },
      };
    }
    if (changes.deleted.has(cleaned)) {
      return {
        ...f,
        message: `this change deletes \`${cleaned}\`, but the context file still references it.`,
        hint: "rewrite or remove the claim — the file is gone.",
      };
    }
    return f;
  });
}

export function diffScan(root: string, range: string, opts: ScanOptions = {}): DiffScanResult {
  const baseline = resolveBaseline(root, range);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-base-"));
  let baselineFindings: Set<string>;
  try {
    git(root, ["worktree", "add", "--detach", tmp, baseline]);
    baselineFindings = new Set(scan(tmp, opts).findings.map(fingerprint));
  } finally {
    try {
      git(root, ["worktree", "remove", "--force", tmp]);
    } catch {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const head = scan(root, opts);
  const fresh = head.findings.filter((f) => !baselineFindings.has(fingerprint(f)));
  const changes = diffNameStatus(root, baseline);

  return {
    ...head,
    findings: attribute(fresh, changes),
    baselineRef: baseline,
    suppressed: head.findings.length - fresh.length,
  };
}
