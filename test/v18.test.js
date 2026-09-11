import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scan } from "../dist/scan.js";
import { applyFixes } from "../dist/fix.js";
import { toRdjsonl } from "../dist/rdjsonl.js";
import { approve, listEntries, propose, sync } from "../dist/memory.js";
import { findMemoryDir } from "../dist/memoryAudit.js";
import { buildTwinsBlock, checkTwins, syncTwins } from "../dist/twins.js";

function workspace(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-v18-"));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("driftlint-v18-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}
const pkg = (scripts) => JSON.stringify({ scripts });
const commands = (root) => scan(root).findings.filter((f) => f.rule === "dead-command");

test("memory: all returned entry paths use forward slashes", (t) => {
  const root = workspace(t);
  const proposal = propose(root, { text: "Keep the entry point small." });
  assert.equal(proposal, ".agent-memory/proposals/keep-the-entry-point-small.md");
  assert.equal(listEntries(root).proposals[0].file, proposal);
  const approved = approve(root, proposal);
  assert.equal(approved, ".agent-memory/approved/keep-the-entry-point-small.md");
  assert.equal(listEntries(root).approved[0].file, approved);
});

test("memory: similar proposals preserve both approved facts and evidence", (t) => {
  const root = workspace(t);
  const first = propose(root, { text: "Always run migrations before starting the server.", evidence: "src/server.ts:1" });
  approve(root, first);
  const second = propose(root, { text: "Always run migrations before starting the worker.", evidence: "src/worker.ts:2" });
  assert.notEqual(second, first);
  approve(root, second);
  const { approved } = listEntries(root);
  assert.equal(approved.length, 2);
  assert.deepEqual(new Set(approved.map((e) => e.evidence)), new Set(["src/server.ts:1", "src/worker.ts:2"]));
  sync(root);
  const content = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  assert.ok(content.includes("starting the server."));
  assert.ok(content.includes("starting the worker."));
});

test("memory: approval handles a collision introduced after proposing", (t) => {
  const root = workspace(t);
  const proposal = propose(root, { text: "Keep both facts.", evidence: "src/new.ts:2" });
  const existing = path.join(root, ".agent-memory", "approved", path.basename(proposal));
  fs.mkdirSync(path.dirname(existing), { recursive: true });
  const original = "---\nevidence: src/old.ts:1\n---\nThe original fact.\n";
  fs.writeFileSync(existing, original);
  const approved = approve(root, proposal);
  assert.equal(fs.readFileSync(existing, "utf8"), original);
  assert.notEqual(path.join(root, approved), existing);
  assert.equal(listEntries(root).approved.length, 2);
  assert.equal(listEntries(root).proposals.length, 0);
});

test("memory: missing proposal leaves approved data untouched", (t) => {
  const root = workspace(t, { ".agent-memory/approved/missing.md": "Keep this.\n" });
  assert.throws(() => approve(root, ".agent-memory/proposals/missing.md"));
  assert.equal(fs.readFileSync(path.join(root, ".agent-memory/approved/missing.md"), "utf8"), "Keep this.\n");
});

test("findMemoryDir: recognizes encoded paths with spaces, dots and Windows separators", (t) => {
  const root = workspace(t);
  const repo = path.join(root, "my project.v1");
  fs.mkdirSync(repo);
  const config = workspace(t);
  const encoded = path.resolve(repo).replace(/[^a-zA-Z0-9]/g, "-");
  const memory = path.join(config, "projects", encoded, "memory");
  fs.mkdirSync(memory, { recursive: true });
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  t.after(() => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  });
  assert.equal(findMemoryDir(repo), memory);
  assert.equal(findMemoryDir(path.join(root, "other")), null);
});

for (const sourceEol of ["\n", "\r\n"]) {
  for (const targetEol of ["\n", "\r\n"]) {
    test(`twins: line endings ${JSON.stringify(sourceEol)} / ${JSON.stringify(targetEol)} are not drift`, (t) => {
      const source = "# App\n\nKeep this instruction.\n";
      const target = `# Personal notes\n\n${buildTwinsBlock("AGENTS.md", source)}\n`.replace(/\n/g, targetEol);
      const root = workspace(t, { "AGENTS.md": source.replace(/\n/g, sourceEol), "CLAUDE.md": target });
      assert.equal(checkTwins(root).ok, true);
      assert.equal(scan(root).findings.filter((f) => f.rule === "twin-drift").length, 0);
      assert.equal(syncTwins(root).action, "unchanged");
      assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), target);
      fs.appendFileSync(path.join(root, "AGENTS.md"), `A real new instruction.${sourceEol}`);
      assert.equal(checkTwins(root).ok, false);
      assert.equal(syncTwins(root).action, "updated");
      assert.equal(checkTwins(root).ok, true);
      const updated = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
      if (targetEol === "\r\n") assert.ok(!/(?<!\r)\n/.test(updated), "preserve CRLF in the target");
      else assert.ok(!updated.includes("\r"), "preserve LF in the target");
    });
  }
}

test("fix and reviewdog: target the command, not the same word in prose", async (t) => {
  const line = "Use test command: `npm run test`.\r\n";
  const root = workspace(t, { "CLAUDE.md": line, "package.json": pkg({ testing: "echo ok" }) });
  const result = scan(root);
  const diagnostic = toRdjsonl(result).split("\n").map(JSON.parse).find((d) => d.code.value === "dead-command");
  assert.equal(diagnostic.suggestions[0].range.start.column, line.lastIndexOf("test") + 1);
  const outcome = await applyFixes(root, result.findings, { yes: true });
  assert.equal(outcome.applied.length, 1);
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "Use test command: `npm run testing`.\r\n");
  assert.equal(commands(root).length, 0);
});

test("fix: multiple and repeated commands on one line keep their original positions", async (t) => {
  const root = workspace(t, {
    "CLAUDE.md": "Try `npm run test` then `yarn lint` then `npm run test`.\n",
    "package.json": pkg({ testing: "echo ok", linting: "echo ok" }),
  });
  const outcome = await applyFixes(root, commands(root), { yes: true });
  assert.equal(outcome.applied.length, 3);
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "Try `npm run testing` then `yarn linting` then `npm run testing`.\n");
  assert.equal(commands(root).length, 0);
});

test("fix: commands inside fences retain their source columns", async (t) => {
  const root = workspace(t, { "CLAUDE.md": "```sh\n  npm run test && make build\n```\n", "package.json": pkg({ testing: "echo ok" }), "Makefile": "building:\n\techo ok\n" });
  await applyFixes(root, commands(root), { yes: true });
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "```sh\n  npm run testing && make building\n```\n");
});

test("fix and reviewdog: ambiguous legacy fixes are skipped", async (t) => {
  const root = workspace(t, { "CLAUDE.md": "old.ts and old.ts\n" });
  const finding = { rule: "dead-path", severity: "error", file: "CLAUDE.md", line: 1, message: "missing", fix: { oldText: "old.ts", newText: "new.ts" } };
  const result = { root, findings: [finding], contextFiles: [], stats: { refsChecked: 0, refsBroken: 0, score: 100 } };
  assert.equal(JSON.parse(toRdjsonl(result)).suggestions, undefined);
  const outcome = await applyFixes(root, [finding], { yes: true });
  assert.equal(outcome.skipped.length, 1);
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "old.ts and old.ts\n");
});

test("fix and reviewdog: stale source columns are skipped", async (t) => {
  const root = workspace(t, { "CLAUDE.md": "old.ts\n" });
  const finding = { rule: "dead-path", severity: "error", file: "CLAUDE.md", line: 1, message: "missing", fix: { oldText: "old.ts", newText: "new.ts", column: 10 } };
  const result = { root, findings: [finding], contextFiles: [], stats: { refsChecked: 0, refsBroken: 0, score: 100 } };
  assert.equal(JSON.parse(toRdjsonl(result)).suggestions, undefined);
  assert.equal((await applyFixes(root, [finding], { yes: true })).skipped.length, 1);
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "old.ts\n");
});

test("fix: conflicting replacements on the same range are both skipped", async (t) => {
  const root = workspace(t, { "CLAUDE.md": "old.ts\n" });
  const finding = { rule: "dead-path", severity: "error", file: "CLAUDE.md", line: 1, message: "missing" };
  const outcome = await applyFixes(root, [
    { ...finding, fix: { oldText: "old.ts", newText: "first.ts", column: 1 } },
    { ...finding, fix: { oldText: "old.ts", newText: "second.ts", column: 1 } },
  ], { yes: true });
  assert.equal(outcome.applied.length, 0);
  assert.equal(outcome.skipped.length, 2);
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "old.ts\n");
});

test("fix: identical duplicate findings are applied once", async (t) => {
  const root = workspace(t, { "CLAUDE.md": "old.ts\n" });
  const finding = { rule: "dead-path", severity: "error", file: "CLAUDE.md", line: 1, message: "missing", fix: { oldText: "old.ts", newText: "new.ts", column: 1 } };
  const outcome = await applyFixes(root, [finding, { ...finding }], { yes: true });
  assert.equal(outcome.applied.length, 1);
  assert.equal(outcome.skipped.length, 1);
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "new.ts\n");
});

test("dead-command: explicit cwd cannot fall back to the root manifest", (t) => {
  const root = workspace(t, {
    "CLAUDE.md": "Run `cd packages/web && npm run deploy`.\n",
    "package.json": pkg({ deploy: "echo root" }),
    "packages/web/package.json": pkg({ test: "echo web" }),
  });
  const found = commands(root);
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warning");
  assert.match(found[0].hint, /package.json/);
});

test("dead-command: explicit make cwd cannot fall back to the root Makefile", (t) => {
  const root = workspace(t, { "CLAUDE.md": "Run `cd packages/web && make deploy`.\n", "Makefile": "deploy:\n", "packages/web/Makefile": "test:\n" });
  assert.equal(commands(root).length, 1);
});

test("dead-command: valid root and nested cwd instructions stay silent", (t) => {
  const root = workspace(t, {
    "CLAUDE.md": "Run `cd packages/web && npm run deploy`. Also `npm run test`.\n",
    "package.json": pkg({ test: "echo root" }),
    "packages/web/package.json": pkg({ deploy: "echo web" }),
    "packages/AGENTS.md": "Run `cd web && npm run deploy`.\n",
    "packages/web/AGENTS.md": "Run `npm run deploy`.\n",
  });
  assert.equal(commands(root).length, 0);
});

test("dead-command: separate code spans do not share a working directory", (t) => {
  const root = workspace(t, {
    "CLAUDE.md": "Use `cd packages/web && npm run test`, then separately `npm run deploy`.\n",
    "package.json": pkg({ test: "echo root" }),
    "packages/web/package.json": pkg({ test: "echo web", deploy: "echo web" }),
  });
  const found = commands(root);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /deploy/);
});

test("ignore: config checks honor exclusions while other configs and path evidence remain available", (t) => {
  const hook = (command) => JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command }] }] } });
  const root = workspace(t, {
    ".driftlintrc.json": JSON.stringify({ ignore: [".cursor/rules/legacy.md", ".claude/settings.local.json", "docs/**"] }),
    ".cursor/rules/legacy.md": "# Ignore me\n",
    ".cursor/rules/live.md": "# Still report me\n",
    ".claude/settings.local.json": hook("node scripts/ignored.js"),
    ".claude/settings.json": hook("node scripts/missing.js"),
    "CLAUDE.md": "Read `docs/guide.md`.\n",
    "docs/guide.md": "# Available as evidence\n",
    "docs/AGENTS.md": "Read `src/missing.ts`.\n",
  });
  const result = scan(root);
  assert.ok(!result.findings.some((f) => [".cursor/rules/legacy.md", ".claude/settings.local.json", "docs/AGENTS.md"].includes(f.file)));
  assert.ok(result.findings.some((f) => f.file === ".cursor/rules/live.md" && f.rule === "silent-config"));
  assert.ok(result.findings.some((f) => f.file === ".claude/settings.json" && f.rule === "dead-config-ref"));
  assert.ok(!result.findings.some((f) => f.rule === "dead-path"));
});
