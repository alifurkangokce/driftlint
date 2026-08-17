import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { diffScan, resolveBaseline } from "../dist/diff.js";

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Temp repo: baseline commit has CLAUDE.md + src/auth.ts, plus PRE-EXISTING drift. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-diff-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "t@t.t");
  git(root, "config", "user.name", "t");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/auth.ts"), "export const a = 1;\n");
  fs.writeFileSync(
    path.join(root, "CLAUDE.md"),
    "# App\n\nAuth lives in `src/auth.ts`.\nOld docs still reference `src/legacy-gone.ts`.\n",
  );
  git(root, "add", "-A");
  git(root, "commit", "-m", "baseline");
  return root;
}

test("diff: only NEW drift is reported; pre-existing drift is suppressed", () => {
  const root = makeRepo();
  git(root, "mv", "src/auth.ts", "src/authn.ts"); // the "PR": rename, CLAUDE.md not updated

  const r = diffScan(root, "HEAD");
  assert.equal(r.findings.length, 1, JSON.stringify(r.findings, null, 2));
  assert.ok(r.suppressed >= 1, "pre-existing legacy-gone finding must be hidden");
  const f = r.findings[0];
  assert.match(f.message, /renames `src\/auth\.ts` → `src\/authn\.ts`/);
  assert.deepEqual(f.fix, { oldText: "src/auth.ts", newText: "src/authn.ts" });
  fs.rmSync(root, { recursive: true, force: true });
});

test("diff: deletion is attributed", () => {
  const root = makeRepo();
  git(root, "rm", "src/auth.ts");
  const r = diffScan(root, "HEAD");
  const f = r.findings.find((x) => x.message.includes("src/auth.ts"));
  assert.ok(f, JSON.stringify(r.findings));
  assert.match(f.message, /deletes `src\/auth\.ts`/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("diff: clean change reports nothing new", () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, "src/other.ts"), "export const b = 2;\n");
  const r = diffScan(root, "HEAD");
  assert.equal(r.findings.length, 0, JSON.stringify(r.findings));
  fs.rmSync(root, { recursive: true, force: true });
});

test("diff: resolveBaseline handles three-dot ranges and single refs", () => {
  const root = makeRepo();
  const head = git(root, "rev-parse", "HEAD");
  assert.equal(resolveBaseline(root, "HEAD"), head);
  assert.equal(resolveBaseline(root, "HEAD...HEAD"), head);
  fs.rmSync(root, { recursive: true, force: true });
});
