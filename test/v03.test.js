import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../dist/scan.js";
import { applyFixes } from "../dist/fix.js";
import { toSarif } from "../dist/sarif.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => path.join(FIXTURES, name);

test("discovery: GEMINI.md, .clinerules and .opencode files are scanned", () => {
  const r = scan(fixture("multi"));
  assert.ok(r.contextFiles.includes("GEMINI.md"));
  assert.ok(r.contextFiles.includes(".clinerules"));
  assert.ok(r.contextFiles.includes(".opencode/command/do.md"));

  const gemini = r.findings.find((f) => f.file === "GEMINI.md" && f.rule === "dead-path");
  assert.ok(gemini, "dead path in GEMINI.md should be found");
  assert.deepEqual(gemini.fix, { oldText: "lib/thing.ts", newText: "src/thing.ts" });

  assert.ok(
    r.findings.some((f) => f.file === ".clinerules" && f.rule === "dead-command"),
    "dead command in .clinerules should be found",
  );
  assert.ok(
    r.findings.some((f) => f.file === ".opencode/command/do.md" && f.rule === "dead-path"),
    "dead path in .opencode command should be found",
  );
});

test("sarif: valid 2.1.0 shape with rules and located results", () => {
  const r = scan(fixture("basic"), { skillBudget: 300 });
  const sarif = toSarif(r, "0.0.0-test");
  assert.equal(sarif.version, "2.1.0");
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.name, "driftlint");
  assert.ok(run.tool.driver.rules.length >= 5);
  assert.equal(run.results.length, r.findings.length);
  const first = run.results[0];
  assert.ok(first.ruleId);
  assert.ok(["error", "warning", "note"].includes(first.level));
  assert.ok(first.locations[0].physicalLocation.region.startLine >= 1);
});

test("fix: --yes applies single-candidate fixes and the re-scan is cleaner", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-fix-"));
  fs.cpSync(fixture("multi"), tmp, { recursive: true });

  const before = scan(tmp);
  const fixable = before.findings.filter((f) => f.fix);
  assert.equal(fixable.length, 1, "exactly the moved-file finding should be fixable");

  const { applied, skipped } = await applyFixes(tmp, before.findings, { yes: true });
  assert.equal(applied.length, 1);
  assert.equal(skipped.length, 0);
  assert.match(fs.readFileSync(path.join(tmp, "GEMINI.md"), "utf8"), /src\/thing\.ts/);

  const after = scan(tmp);
  assert.ok(
    !after.findings.some((f) => f.message.includes("lib/thing.ts")),
    "fixed finding must disappear on re-scan",
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("fix: non-TTY without --yes touches nothing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-nofix-"));
  fs.cpSync(fixture("multi"), tmp, { recursive: true });
  const before = scan(tmp);
  const original = fs.readFileSync(path.join(tmp, "GEMINI.md"), "utf8");

  const { applied, skipped } = await applyFixes(tmp, before.findings, { yes: false });
  assert.equal(applied.length, 0);
  assert.ok(skipped.length >= 1);
  assert.equal(fs.readFileSync(path.join(tmp, "GEMINI.md"), "utf8"), original);
  fs.rmSync(tmp, { recursive: true, force: true });
});
