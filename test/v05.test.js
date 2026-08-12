import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { approve, listEntries, propose, sync } from "../dist/memory.js";
import { scan } from "../dist/scan.js";

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-mem-"));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Project\n\nSome intro.\n");
  return dir;
}

test("memory: propose writes a frontmatter entry under proposals/", () => {
  const root = tmpRepo();
  const rel = propose(root, { text: "Auth goes through the BFF.", evidence: "src/auth.ts:42", source: "claude-code" });
  assert.match(rel, /^\.agent-memory\/proposals\/auth-goes-through-the-bff\.md$/);
  const { proposals } = listEntries(root);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].text, "Auth goes through the BFF.");
  assert.equal(proposals[0].evidence, "src/auth.ts:42");
  fs.rmSync(root, { recursive: true, force: true });
});

test("memory: approve moves the entry; sync writes an idempotent block", () => {
  const root = tmpRepo();
  const rel = propose(root, { text: "Migrations run via `npm run migrate`.", scope: "db/" });
  approve(root, rel);
  const { proposals, approved } = listEntries(root);
  assert.equal(proposals.length, 0);
  assert.equal(approved.length, 1);

  let targets = sync(root);
  assert.deepEqual(targets, ["CLAUDE.md"]);
  const first = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  assert.match(first, /driftlint-memory:start/);
  assert.match(first, /Migrations run via/);
  assert.match(first, /scope: db\//);

  sync(root); // ikinci sync blok ÇOĞALTMAMALI
  const second = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  assert.equal(second.split("driftlint-memory:start").length, 2, "block must be replaced, not duplicated");
  assert.equal(second.split("## Team memory").length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test("memory: approved entries are scanned — dead paths in memory get flagged", () => {
  const root = tmpRepo();
  const rel = propose(root, { text: "The queue worker lives in `src/workers/queue.ts`." });
  approve(root, rel);
  const r = scan(root);
  assert.ok(r.contextFiles.some((f) => f.startsWith(".agent-memory/approved/")));
  assert.ok(
    r.findings.some((f) => f.file.startsWith(".agent-memory/") && f.rule === "dead-path"),
    JSON.stringify(r.findings),
  );
  fs.rmSync(root, { recursive: true, force: true });
});
