import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scan } from "../dist/scan.js";

function tmp(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-v16-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

// #23 — the surfaces agents actually load, including nested ones
test("discovery covers the rule, skill and sub-agent directories agents read", () => {
  const claim = "Entry point is `src/gone.ts`.\n";
  const dir = tmp({
    ".claude/rules/style.md": claim,
    ".claude/rules/backend/api.md": claim,
    ".claude/agents/backend/reviewer.md": claim,
    ".claude/commands/deploy/prod.md": claim,
    ".github/instructions/frontend.instructions.md": claim,
    ".github/agents/planner.agent.md": claim,
    ".codex/rules/house.rules": claim,
    ".agents/skills/shared/SKILL.md": `---\nname: shared\ndescription: x\n---\n${claim}`,
    ".gemini/agents/helper.md": claim,
    ".cursor/agents/pair.md": claim,
    "AGENTS.override.md": claim,
    "docs/nested/AGENTS.md": claim,
    "src/app.ts": "export {};\n",
  });
  const found = new Set(scan(dir).contextFiles);
  for (const rel of [
    ".claude/rules/style.md",
    ".claude/rules/backend/api.md",
    ".claude/agents/backend/reviewer.md",
    ".claude/commands/deploy/prod.md",
    ".github/instructions/frontend.instructions.md",
    ".github/agents/planner.agent.md",
    ".codex/rules/house.rules",
    ".agents/skills/shared/SKILL.md",
    ".gemini/agents/helper.md",
    ".cursor/agents/pair.md",
    "AGENTS.override.md",
    "docs/nested/AGENTS.md",
  ]) {
    assert.ok(found.has(rel), `${rel} should be discovered`);
  }
});

test("discovery: the new surfaces get the same checks, not just a listing", () => {
  const dir = tmp({
    ".claude/rules/backend/api.md": "The handler lives in `src/gone.ts`.\n",
    "src/app.ts": "export {};\n",
  });
  const dead = scan(dir).findings.filter((f) => f.rule === "dead-path");
  assert.equal(dead.length, 1);
  assert.equal(dead[0].file, ".claude/rules/backend/api.md");
});

test("discovery: unrelated markdown in those trees is still ignored", () => {
  const dir = tmp({
    ".claude/notes.md": "Entry point is `src/gone.ts`.\n",
    "docs/guide.md": "Entry point is `src/gone.ts`.\n",
    ".github/workflows/ci.yml": "name: ci\n",
    "src/app.ts": "export {};\n",
  });
  assert.deepEqual(scan(dir).contextFiles, []);
});

// #24 — the user-level file shares the same 32KB budget
test("user-scope: opt-in folds ~/.codex/AGENTS.md into the concatenated total", () => {
  const chunk = (kb) => `# Rules\n\n${"Some perfectly ordinary sentence about the project. ".repeat(kb * 20)}`;
  const dir = tmp({ "AGENTS.md": chunk(14), "packages/api/AGENTS.md": chunk(4) });
  const codexHome = tmp({ "AGENTS.md": chunk(20) });

  const budget = (opts) => scan(dir, opts).findings.filter((f) => f.rule === "load-budget");
  assert.deepEqual(budget({}), [], "18 KB of repo files fits on its own");

  const prev = process.env["CODEX_HOME"];
  process.env["CODEX_HOME"] = codexHome;
  try {
    const found = budget({ userScope: true });
    assert.equal(found.length, 1);
    assert.match(found[0].message, /including user scope/);
    assert.match(found[0].hint, /~\/\.codex\/AGENTS\.md \(20\.\d KB\)/, "the user file is named as a contributor");
    assert.ok(!found[0].hint.includes("pass --user-scope"), "no need to suggest what is already on");
  } finally {
    if (prev === undefined) delete process.env["CODEX_HOME"];
    else process.env["CODEX_HOME"] = prev;
  }
});

test("user-scope: content is never read, only the size", () => {
  const dir = tmp({ "AGENTS.md": "# Rules\n\nShort.\n" });
  const secret = "MY-PRIVATE-CLIENT-NAME";
  const codexHome = tmp({ "AGENTS.md": `# Personal\n\n${secret}\n` });
  const prev = process.env["CODEX_HOME"];
  process.env["CODEX_HOME"] = codexHome;
  try {
    const json = JSON.stringify(scan(dir, { userScope: true }));
    assert.ok(!json.includes(secret), "nothing from the user's file may appear in a finding");
  } finally {
    if (prev === undefined) delete process.env["CODEX_HOME"];
    else process.env["CODEX_HOME"] = prev;
  }
});
