import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scan } from "../dist/scan.js";
import { checkTwins, syncTwins } from "../dist/twins.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "twins");
const fixture = (n) => path.join(FIXTURES, n);

function tmp(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-v10-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const twinFindings = (dir) => scan(dir).findings.filter((f) => f.rule === "twin-drift");

// --- twin-drift rule ---

test("twin-drift: near-duplicate CLAUDE.md/AGENTS.md with differing commands warns once", () => {
  const findings = twinFindings(fixture("diverged"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /drifted apart/);
  assert.match(findings[0].message, /`test`.*only in CLAUDE\.md/);
  assert.match(findings[0].message, /`check`.*only in AGENTS\.md/);
  assert.match(findings[0].hint, /@AGENTS\.md|driftlint twins/);
});

test("twin-drift: an @AGENTS.md import bridges the pair — no finding", () => {
  assert.equal(twinFindings(fixture("bridged")).length, 0);
});

test("twin-drift: stale twins mirror block is an error pointing at the block", () => {
  const findings = twinFindings(fixture("stale"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.equal(findings[0].file, "CLAUDE.md");
  assert.equal(findings[0].line, 3);
  assert.match(findings[0].message, /stale/);
});

test("twin-drift: genuinely different files with no shared claims stay silent", () => {
  const dir = tmp({
    "CLAUDE.md": "# Claude notes\n\nPrefer short answers and cite file paths.\n",
    "AGENTS.md": "# Build guide\n\nThis service compiles with the standard toolchain.\n",
  });
  assert.equal(twinFindings(dir).length, 0);
});

// --- driftlint twins sync / check ---

test("twins: sync creates the mirror, check passes, edits make it stale, re-sync heals", () => {
  const dir = tmp({ "AGENTS.md": "# Rules\n\nRun `npm run build` daily.\n" });

  const created = syncTwins(dir);
  assert.equal(created.source, "AGENTS.md");
  assert.equal(created.target, "CLAUDE.md");
  assert.equal(created.action, "created");
  assert.ok(checkTwins(dir).ok);
  assert.equal(twinFindings(dir).length, 0);

  // idempotent
  assert.equal(syncTwins(dir).action, "unchanged");

  fs.appendFileSync(path.join(dir, "AGENTS.md"), "\nAlso run `npm run lint`.\n");
  const stale = checkTwins(dir);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "stale");
  assert.equal(twinFindings(dir)[0]?.severity, "error");

  assert.equal(syncTwins(dir).action, "updated");
  assert.ok(checkTwins(dir).ok);
});

test("twins: sync preserves content outside the marker block", () => {
  const dir = tmp({
    "AGENTS.md": "# Shared rules\n\nAlways run the linter.\n",
    "CLAUDE.md": "# My Claude preamble\n\nKeep answers short.\n",
  });
  syncTwins(dir);
  const out = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
  assert.match(out, /My Claude preamble/);
  assert.match(out, /driftlint-twins:start/);
  assert.match(out, /Always run the linter\./);
  assert.equal(twinFindings(dir).length, 0);
});

test("twins: a mirror never nests another mirror or a memory block", () => {
  const dir = tmp({
    "AGENTS.md":
      "# Rules\n\n<!-- driftlint-memory:start — generated -->\n- remembered fact\n<!-- driftlint-memory:end -->\nReal instruction here.\n",
  });
  syncTwins(dir);
  const out = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
  assert.ok(!out.includes("driftlint-memory"), "memory block must not be mirrored");
  assert.match(out, /Real instruction here\./);
});

// --- untracked-context rule ---

const git = (dir, ...args) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

test("untracked-context: uncommitted and gitignored context files warn; CLAUDE.local.md is exempt", () => {
  const dir = tmp({
    "CLAUDE.md": "# Notes\n\nGeneral guidance for this service only.\n",
    "CLAUDE.local.md": "# Personal scratch\n\nMy own reminders.\n",
    ".gitignore": ".windsurfrules\n",
    ".windsurfrules": "personal windsurf rules\n",
  });
  git(dir, "init", "-q");

  let findings = scan(dir).findings.filter((f) => f.rule === "untracked-context");
  const byFile = new Map(findings.map((f) => [f.file, f]));
  assert.match(byFile.get("CLAUDE.md")?.message ?? "", /not committed/);
  assert.match(byFile.get(".windsurfrules")?.message ?? "", /gitignored/);
  assert.equal(byFile.has("CLAUDE.local.md"), false, "local files are personal by convention");

  git(dir, "add", "CLAUDE.md");
  findings = scan(dir).findings.filter((f) => f.rule === "untracked-context");
  assert.equal(findings.some((f) => f.file === "CLAUDE.md"), false, "staged file counts as tracked");
});

test("untracked-context: outside a git repo the rule stays silent", () => {
  const dir = tmp({ "CLAUDE.md": "# Notes\n\nGeneral guidance only.\n" });
  assert.equal(scan(dir).findings.filter((f) => f.rule === "untracked-context").length, 0);
});
