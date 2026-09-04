import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scan } from "../dist/scan.js";
import { applyFixes } from "../dist/fix.js";

function tmp(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-v15-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

// #13 — a fix must write exactly the text we showed the user
test("--fix writes $ sequences literally instead of splicing surrounding text", async () => {
  const cases = ["a$&b", "a$$b", "a$`b", "a$'b", "plain.ts"];
  for (const newText of cases) {
    const dir = tmp({ "CLAUDE.md": "# App\n\nEntry: `old.ts` here.\n" });
    const finding = {
      rule: "dead-path",
      severity: "error",
      file: "CLAUDE.md",
      line: 3,
      message: "`old.ts` does not exist.",
      fix: { oldText: "old.ts", newText },
    };
    const { applied } = await applyFixes(dir, [finding], { yes: true });
    assert.equal(applied.length, 1, `${newText} should apply`);
    assert.equal(
      fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"),
      `# App\n\nEntry: \`${newText}\` here.\n`,
      `replacement "${newText}" must land verbatim`,
    );
  }
});

// #14 — one unreadable file must not take the whole scan down
test("an unreadable Makefile is skipped, not fatal", (t) => {
  const dir = tmp({
    "CLAUDE.md": "# App\n\nBuild with `make release`, test with `npm run test`.\n",
    "package.json": '{ "name": "t", "scripts": { "test": "node --test" } }\n',
    Makefile: "release:\n\techo ok\n",
  });
  const makefile = path.join(dir, "Makefile");
  fs.chmodSync(makefile, 0o000);
  try {
    fs.readFileSync(makefile, "utf8");
    return t.skip("running with privileges that ignore file permissions");
  } catch {
    /* good: the read really is blocked */
  }

  const result = scan(dir); // must not throw
  assert.ok(result.contextFiles.includes("CLAUDE.md"), "the scan still produces a result");
  assert.equal(
    result.findings.some((f) => f.rule === "dead-command" && f.message.includes("`test`")),
    false,
    "the readable manifest is still indexed",
  );
  fs.chmodSync(makefile, 0o644);
});

// #15 — the message must name the script the reader will search for
test("twin-drift names scoped scripts in full (test:unit, not test)", () => {
  const dir = tmp({
    "CLAUDE.md": "# App\n\nRun `npm run test:unit` before pushing.\nAlso `npm run lint:fix`.\n",
    "AGENTS.md": "# App\n\nRun `npm run check:types` before pushing.\nAlso `npm run lint:fix`.\n",
    "package.json":
      '{ "name": "t", "scripts": { "test:unit": "x", "lint:fix": "x", "check:types": "x" } }\n',
  });
  const found = scan(dir).findings.filter((f) => f.rule === "twin-drift");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /`test:unit`.*only in CLAUDE\.md/);
  assert.match(found[0].message, /`check:types`.*only in AGENTS\.md/);
});

// #16 — ALL-CAPS is not proof of a placeholder
test("broken links and paths to LICENSE-style files are still reported", () => {
  const dir = tmp({
    "CLAUDE.md": [
      "# App",
      "",
      "Licensed under the [MIT license](LICENSE), see also [changelog](CHANGELOG).",
      "Ticket template: [details](TFS_LINK) and [docs](YOUR_DOC_URL).",
      "Notices live in `docs/NOTICE`; templates live in `TEMPLATE/x.md`.",
    ].join("\n"),
  });
  const messages = scan(dir).findings.map((f) => f.message);
  assert.ok(messages.some((m) => m.includes("LICENSE")), "a broken LICENSE link is real");
  assert.ok(messages.some((m) => m.includes("CHANGELOG")), "so is CHANGELOG");
  assert.ok(messages.some((m) => m.includes("docs/NOTICE")), "and a nested NOTICE path");
  assert.ok(!messages.some((m) => m.includes("TFS_LINK")), "fill-in markers stay exempt");
  assert.ok(!messages.some((m) => m.includes("YOUR_DOC_URL")), "so do URL placeholders");
  assert.ok(!messages.some((m) => m.includes("TEMPLATE/")), "and template dirs");
});

// #18 — yarn's own subcommands are not package scripts
test("yarn built-ins are not reported as missing scripts", () => {
  const dir = tmp({
    "CLAUDE.md":
      "# App\n\nRun `yarn audit` and `yarn outdated`, then `yarn upgrade`.\nAlso `yarn workspace web build`.\nOur own: `yarn verify`.\n",
    "package.json": '{ "name": "t", "scripts": { "build": "x" } }\n',
  });
  const dead = scan(dir).findings.filter((f) => f.rule === "dead-command");
  assert.deepEqual(
    dead.map((f) => f.message),
    ["script `verify` is not in package.json scripts."],
    "only the repo's own missing script counts",
  );
});

// #17 — ignore globs must cover what --llm reads, not just what it lints
test("--llm evidence pool honours the config ignore globs", async () => {
  const { runLlmPass } = await import("../dist/llm.js");
  const dir = tmp({
    "CLAUDE.md": "# App\n\nAuthentication goes through the gateway service.\n",
    "docs/archive/old-notes.md": "authentication used to go through the monolith\n",
    "src/gateway.ts": "export const authentication = 1;\n",
    ".driftlintrc.json": JSON.stringify({ ignore: ["docs/archive/**"] }),
  });
  const prompts = [];
  const complete = async (system, user) => {
    prompts.push(`${system}\n${user}`);
    return { data: { claims: [] }, usage: { inputTokens: 0, outputTokens: 0 } };
  };
  await runLlmPass(dir, { complete, config: { ignore: ["docs/archive/**"] } });
  const all = prompts.join("\n");
  assert.ok(!all.includes("old-notes"), "an ignored path must not reach the model");
  assert.ok(!all.includes("used to go through the monolith"), "nor its contents");
});

// #19 — a fenced YAML list is an example, not 170 instructions
test("load-budget does not count bullets inside fenced blocks", () => {
  const fenced = Array.from({ length: 170 }, (_, i) => `  - name: step-${i}`).join("\n");
  const dir = tmp({
    "CLAUDE.md": `# Guide\n\n- run tests before pushing\n- keep modules small\n\n\`\`\`yaml\n${fenced}\n\`\`\`\n`,
  });
  const found = scan(dir).findings.filter((f) => f.message.includes("instruction-like"));
  assert.deepEqual(found, [], "two real bullets is not an adherence problem");
});

// #20 — documentation about the rules is not a rule that failed to load
test("silent-config leaves .cursor/rules/README.md alone", () => {
  const dir = tmp({
    ".cursor/rules/README.md": "# How these rules work\n\nDocs for humans.\n",
    ".cursor/rules/style.md": "Always use tabs.\n",
  });
  const found = scan(dir).findings.filter((f) => f.rule === "silent-config");
  assert.equal(found.length, 1);
  assert.equal(found[0].file, ".cursor/rules/style.md");
});

// #21 — a loose list keeps its reason in the indented paragraph
test("missing-rationale reads the bullet's indented continuation", () => {
  const withReasons = [
    "# Rules",
    "",
    "- Never commit directly to main.",
    "",
    "  Because the release job tags from main and a stray commit breaks the tag.",
    "",
    "- Always run the migration before deploying.",
    "",
    "  Otherwise the app boots against an older schema and 500s.",
    "",
    "- Must review database changes.",
    "",
    "  Since a bad index locks the table in production.",
    "",
    "- Never skip the changelog.",
    "",
    "  To keep release notes honest.",
    "",
    "- Always pin dependencies.",
    "",
    "  Because a floating minor broke the build twice.",
    "",
  ].join("\n");
  const dir = tmp({ "CLAUDE.md": withReasons });
  assert.deepEqual(
    scan(dir).findings.filter((f) => f.rule === "missing-rationale"),
    [],
    "reasons in the continuation block count",
  );

  // …and a wall of bare directives still gets caught
  const bare = ["# Rules", ""].concat(
    ["Never commit to main.", "Always pin deps.", "Must review DB changes.", "Never skip tests.", "Always tag releases."].map(
      (d) => `- ${d}`,
    ),
  );
  const dir2 = tmp({ "CLAUDE.md": `${bare.join("\n")}\n` });
  assert.equal(scan(dir2).findings.filter((f) => f.rule === "missing-rationale").length, 1);
});

// #22 — ?plain=1 is a view parameter on a real file
test("dead-link strips query strings before resolving", () => {
  const dir = tmp({
    "CLAUDE.md":
      "# App\n\nSee [plain](docs/deploy.md?plain=1) and [anchored](docs/deploy.md?plain=1#staging).\nAlso [gone](docs/gone.md?raw=true).\n",
    "docs/deploy.md": "# Deploy\n\n## Staging\n",
  });
  const found = scan(dir).findings.filter((f) => f.rule === "dead-link");
  assert.equal(found.length, 1, "only the genuinely missing target is reported");
  assert.match(found[0].message, /docs\/gone\.md/);
});

// Reported on r/ClaudeCode: Codex truncates the *concatenated* instruction set,
// so per-file checks understate the risk.
test("load-budget catches AGENTS.md files that only blow the 32KB limit together", () => {
  const chunk = (kb) => `# Rules\n\n${"Some perfectly ordinary sentence about the project. ".repeat(kb * 20)}`;
  const dir = tmp({
    "AGENTS.md": chunk(12),
    "packages/api/AGENTS.md": chunk(12),
    "packages/web/AGENTS.md": chunk(12),
  });
  const found = scan(dir).findings.filter((f) => f.rule === "load-budget");
  assert.equal(found.length, 1, "one combined finding, not one per file");
  assert.equal(found[0].file, "AGENTS.md", "reported on the root file");
  assert.match(found[0].message, /concatenates/);
  assert.match(found[0].hint, /global ~\/\.codex\/AGENTS\.md/);
});

test("load-budget: files that fit together stay silent, and a single oversized file is not double-reported", () => {
  const small = "# Rules\n\nKeep it short.\n";
  const fits = tmp({ "AGENTS.md": small, "packages/api/AGENTS.md": small });
  assert.deepEqual(scan(fits).findings.filter((f) => f.rule === "load-budget"), []);

  const huge = `# Rules\n\n${"Some perfectly ordinary sentence about the project. ".repeat(800)}`;
  const over = tmp({ "AGENTS.md": huge, "packages/api/AGENTS.md": small });
  const found = scan(over).findings.filter((f) => f.rule === "load-budget");
  assert.equal(found.length, 1, "the per-file finding is enough");
  assert.match(found[0].message, /silently truncates at 32 KB/);
});
