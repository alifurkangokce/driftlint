import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { auditMemory, findMemoryDir } from "../dist/memoryAudit.js";

function tmp(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-v11-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function fixture() {
  const repo = tmp({
    "src/app.ts": "export {};\n",
    "package.json": '{ "name": "x", "scripts": { "test": "node --test" } }\n',
  });
  const memory = tmp({
    "MEMORY.md":
      "# Memory index\n\n- [App entry](app-entry.md) — `src/app.ts` structure, see [[app-entry]]\n- Old note about `src/legacy.ts` and `npm run deploy`\n- Dangling pointer to [[deleted-topic]]\n",
    "app-entry.md": "The entry point is `src/app.ts`. Run `npm run test` before commits.\n",
  });
  return { repo, memory };
}

test("memory audit: dead repo references inside memories are flagged", () => {
  const { repo, memory } = fixture();
  const result = auditMemory(repo, memory);
  const dead = result.findings.filter((f) => f.rule === "dead-path" && f.message.includes("legacy"));
  assert.equal(dead.length, 1, "src/legacy.ts should be dead");
  const cmd = result.findings.filter((f) => f.rule === "dead-command");
  assert.equal(cmd.length, 1);
  assert.match(cmd[0].message, /`deploy`/);
  // living references stay silent
  assert.ok(!result.findings.some((f) => f.message.includes("app.ts")));
  assert.ok(!result.findings.some((f) => f.message.includes("`test`")));
});

test("memory audit: broken [[wiki-links]] warn, resolvable ones don't", () => {
  const { repo, memory } = fixture();
  const result = auditMemory(repo, memory);
  const links = result.findings.filter((f) => f.message.includes("[["));
  assert.equal(links.length, 1);
  assert.match(links[0].message, /\[\[deleted-topic\]\]/);
  assert.equal(links[0].severity, "warning");
});

test("memory audit: MEMORY.md past the 200-line fold gets a load-budget warning", () => {
  const { repo } = fixture();
  const memory = tmp({
    "MEMORY.md": `# Index\n${"- a memory line\n".repeat(220)}`,
  });
  const result = auditMemory(repo, memory);
  const fold = result.findings.filter((f) => f.rule === "load-budget");
  assert.equal(fold.length, 1);
  assert.match(fold[0].message, /200-line fold/);
  assert.equal(fold[0].line, 201);
});

test("memory audit: a healthy memory dir is silent", () => {
  const repo = tmp({ "src/app.ts": "export {};\n" });
  const memory = tmp({
    "MEMORY.md": "# Index\n\n- [entry](app-entry.md) — where `src/app.ts` lives, see [[app-entry]]\n",
    "app-entry.md": "Entry is `src/app.ts`.\n",
  });
  const result = auditMemory(repo, memory);
  assert.equal(result.findings.length, 0);
  assert.equal(result.stats.score, 100);
});

test("memory audit: [[links]] resolve via frontmatter name slugs and kebab/snake variants", () => {
  const repo = tmp({ "src/app.ts": "export {};\n" });
  const memory = tmp({
    "MEMORY.md": "# Index\n\n- see [[app-entry-notes]] and [[some-topic]]\n",
    "app_entry.md": "---\nname: app-entry-notes\ndescription: entry notes\n---\nEntry facts.\n",
    "some_topic.md": "Topic facts.\n",
  });
  const result = auditMemory(repo, memory);
  assert.equal(result.findings.filter((f) => f.message.includes("[[")).length, 0);
});

test("memory audit: bare filenames from other repos warn instead of erroring", () => {
  const repo = tmp({ "src/app.ts": "export {};\n" });
  const memory = tmp({
    "MEMORY.md": "# Index\n\n- the other repo's `rule.json` holds the routes\n",
  });
  const result = auditMemory(repo, memory);
  const f = result.findings.find((x) => x.message.includes("rule.json"));
  assert.equal(f?.severity, "warning");
  assert.equal(result.stats.refsBroken, 0, "bare-name warnings must not dent the score");
});

test("memory audit: a memory describing another repo collapses into one info", () => {
  const repo = tmp({ "src/app.ts": "export {};\n" });
  const memory = tmp({
    "other-repo.md":
      "That service keeps `lib/core.rb`, `lib/api.rb`, `app/models/user.rb`, `config/routes.rb` and `spec/core_spec.rb` in the usual Rails layout.\n",
  });
  const result = auditMemory(repo, memory);
  const foreign = result.findings.filter((f) => f.rule === "foreign-context");
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0].severity, "info");
  assert.equal(result.findings.filter((f) => f.rule === "dead-path").length, 0);
  assert.equal(result.stats.refsChecked, 0, "collapsed files must not dent the score");
});

test("findMemoryDir: resolves the munged project path under CLAUDE_CONFIG_DIR", () => {
  const repo = tmp({ "README.md": "# x\n" });
  const configDir = tmp();
  const munged = path.resolve(repo).replace(/\//g, "-");
  fs.mkdirSync(path.join(configDir, "projects", munged, "memory"), { recursive: true });

  const prev = process.env["CLAUDE_CONFIG_DIR"];
  process.env["CLAUDE_CONFIG_DIR"] = configDir;
  try {
    assert.equal(findMemoryDir(repo), path.join(configDir, "projects", munged, "memory"));
    assert.equal(findMemoryDir(tmp()), null);
  } finally {
    if (prev === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
    else process.env["CLAUDE_CONFIG_DIR"] = prev;
  }
});
