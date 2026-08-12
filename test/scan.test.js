import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { applyBaseline, fingerprint, globToRegex, scan } from "../dist/scan.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => path.join(FIXTURES, name);

test("basic: dead paths, dead commands, skill budget, ignore marker", () => {
  const r = scan(fixture("basic"), { skillBudget: 300 });
  const errors = r.findings.filter((f) => f.severity === "error");
  const warnings = r.findings.filter((f) => f.severity === "warning");
  assert.equal(errors.length, 3, JSON.stringify(r.findings, null, 2));
  assert.equal(warnings.length, 1);

  const moved = errors.find((f) => f.message.includes("lib/util.ts"));
  assert.ok(moved, "moved file should be flagged");
  assert.match(moved.hint ?? "", /src\/util\.ts/, "did-you-mean hint should point at the new location");

  const deadCmd = errors.find((f) => f.rule === "dead-command");
  assert.ok(deadCmd, "removed script should be flagged");
  assert.match(deadCmd.hint ?? "", /deploy/, "closest-script hint expected");

  assert.ok(
    !r.findings.some((f) => f.message.includes("never-existed")),
    "driftlint-ignore lines must be skipped",
  );
});

test("fp: known false-positive classes stay silent", () => {
  const r = scan(fixture("fp"));
  assert.deepEqual(r.findings, [], JSON.stringify(r.findings, null, 2));
});

test("monorepo: workspace script downgrades to a located warning", () => {
  const r = scan(fixture("monorepo"));
  const develop = r.findings.find((f) => f.message.includes("develop"));
  assert.ok(develop, "script defined only in a workspace package should be reported");
  assert.equal(develop.severity, "warning");
  assert.match(develop.hint ?? "", /packages\/client\/package\.json/);

  const missing = r.findings.find((f) => f.message.includes("missing:script"));
  assert.ok(missing, "script defined nowhere should be reported");
  assert.equal(missing.severity, "error");

  assert.ok(!r.findings.some((f) => f.message.includes("`build`")), "existing script must not be flagged");
});

test("crossrepo: mostly-unresolved file collapses into one foreign-context warning", () => {
  const r = scan(fixture("crossrepo"));
  const foreign = r.findings.filter((f) => f.rule === "foreign-context");
  assert.equal(foreign.length, 1, JSON.stringify(r.findings, null, 2));
  assert.equal(foreign[0].severity, "warning");
  assert.equal(
    r.findings.filter((f) => f.rule === "dead-path").length,
    0,
    "individual dead-path findings must be collapsed",
  );
});

test("config: rules override, ignore globs, and skillBudget apply", () => {
  const r = scan(fixture("config"));
  assert.ok(!r.findings.some((f) => f.rule === "dead-command"), "dead-command is off");
  assert.ok(r.findings.some((f) => f.rule === "skill-budget"), "config skillBudget=200 should trigger");
  assert.ok(
    !r.contextFiles.includes("ignored/CLAUDE.md"),
    "ignored glob must exclude the context file",
  );
  assert.ok(!r.findings.some((f) => f.file.startsWith("ignored/")));
});

test("baseline: fingerprints filter known findings", () => {
  const r = scan(fixture("basic"), { skillBudget: 300 });
  assert.ok(r.findings.length > 0);
  const baseline = new Set(r.findings.map(fingerprint));
  assert.deepEqual(applyBaseline(r.findings, baseline), []);
  const partial = new Set([fingerprint(r.findings[0])]);
  assert.equal(applyBaseline(r.findings, partial).length, r.findings.length - 1);
});

test("globToRegex: * stays within a segment, ** crosses segments", () => {
  assert.ok(globToRegex("docs/**").test("docs/a/b/CLAUDE.md"));
  assert.ok(globToRegex("*.md").test("CLAUDE.md"));
  assert.ok(!globToRegex("*.md").test("docs/CLAUDE.md"));
  assert.ok(globToRegex("**/archive/**").test("x/archive/y/AGENTS.md"));
  assert.ok(!globToRegex("docs/*").test("docs/a/b"));
});
