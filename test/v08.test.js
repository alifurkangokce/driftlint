import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../dist/scan.js";
import { badgeJson } from "../dist/badge.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (n) => path.join(FIXTURES, n);

function tmp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-v08-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

test("load-budget: AGENTS.md past 32KB warns about Codex silent truncation", () => {
  const big = `# App\n\n${"Some perfectly ordinary sentence about the project. ".repeat(700)}`;
  assert.ok(Buffer.byteLength(big) > 32768, "fixture must exceed the limit");
  const dir = tmp({ "AGENTS.md": big });
  const r = scan(dir);
  const f = r.findings.find((x) => x.rule === "load-budget" && x.severity === "warning");
  assert.ok(f, JSON.stringify(r.findings));
  assert.match(f.message, /32 KB/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("load-budget: >150 instruction-like lines gets an adherence info", () => {
  const bullets = Array.from({ length: 160 }, (_, i) => `- guideline number ${i} about style`).join("\n");
  const dir = tmp({ "CLAUDE.md": `# Rules\n\n${bullets}\n` });
  const r = scan(dir);
  const f = r.findings.find((x) => x.rule === "load-budget" && x.severity === "info");
  assert.ok(f, JSON.stringify(r.findings));
  assert.match(f.message, /160 instruction-like lines/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("missing-rationale: directive walls without reasons collapse into one info", () => {
  const bare = Array.from({ length: 6 }, (_, i) => `- NEVER touch module ${i}`).join("\n");
  const dir = tmp({ "CLAUDE.md": `# Rules\n\n${bare}\n` });
  const r = scan(dir);
  const f = r.findings.filter((x) => x.rule === "missing-rationale");
  assert.equal(f.length, 1, JSON.stringify(r.findings));
  assert.match(f[0].message, /6 of 6 strong directives/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("missing-rationale: reasons on the directives keep it silent", () => {
  const reasoned = Array.from({ length: 6 }, (_, i) => `- NEVER touch module ${i} because it breaks replication`).join("\n");
  const dir = tmp({ "CLAUDE.md": `# Rules\n\n${reasoned}\n` });
  const r = scan(dir);
  assert.ok(!r.findings.some((x) => x.rule === "missing-rationale"), JSON.stringify(r.findings));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("score: broken references lower it; clean fixtures stay at 100", () => {
  const basic = scan(fixture("basic"), { skillBudget: 300 });
  assert.ok(basic.stats.refsChecked >= 3, JSON.stringify(basic.stats));
  assert.equal(basic.stats.refsBroken, 2);
  assert.ok(basic.stats.score < 100 && basic.stats.score > 0);

  const fp = scan(fixture("fp"));
  assert.equal(fp.stats.score, 100, JSON.stringify(fp.stats));
});

test("badgeJson: shields endpoint shape and color thresholds", () => {
  assert.deepEqual(badgeJson(96), { schemaVersion: 1, label: "context freshness", message: "96%", color: "brightgreen" });
  assert.equal(badgeJson(80).color, "yellowgreen");
  assert.equal(badgeJson(65).color, "yellow");
  assert.equal(badgeJson(45).color, "orange");
  assert.equal(badgeJson(10).color, "red");
});
