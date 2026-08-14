import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../dist/scan.js";

const fixture = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", n);

test("template: driftlint-template marker suppresses path checks with one info", () => {
  const r = scan(fixture("template"));
  const claude = r.findings.filter((f) => f.file === "CLAUDE.md");
  assert.equal(claude.length, 1, JSON.stringify(claude));
  assert.equal(claude[0].rule, "template-context");
  assert.equal(claude[0].severity, "info");
});

test("template: config templates glob suppresses matched files", () => {
  const r = scan(fixture("template"));
  const globbed = r.findings.filter((f) => f.file.includes("globbed"));
  assert.equal(globbed.length, 1, JSON.stringify(globbed));
  assert.equal(globbed[0].rule, "template-context");
  assert.equal(globbed[0].severity, "info");
});

test("template: heuristic collapses generator-vocab files into one warning", () => {
  const r = scan(fixture("template"));
  const scaf = r.findings.filter((f) => f.file.includes("scaffolder"));
  assert.equal(scaf.length, 1, JSON.stringify(scaf));
  assert.equal(scaf[0].rule, "template-context");
  assert.equal(scaf[0].severity, "warning");
  assert.match(scaf[0].hint ?? "", /driftlint-template/);
});

test("template: application-repo findings are untouched (guard)", () => {
  const r = scan(fixture("basic"), { skillBudget: 300 });
  assert.equal(r.findings.filter((f) => f.severity === "error").length, 3);
  assert.ok(!r.findings.some((f) => f.rule === "template-context"));
});
