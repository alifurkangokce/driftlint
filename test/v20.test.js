import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scan } from "../dist/scan.js";
import { extractImports } from "../dist/checks/imports.js";

function workspace(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-v20-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}
const of = (result, rule) => result.findings.filter((f) => f.rule === rule);

// ---------------------------------------------------------------- dead-import

test("dead-import: an @import of a missing file is an error, with the one real candidate as the fix", () => {
  const dir = workspace({
    "CLAUDE.md": "# Project\n\nAPI conventions @docs/api-conventions.md\n",
    "docs/guides/api-conventions.md": "# API\n",
  });
  const [f, ...rest] = of(scan(dir), "dead-import");
  assert.equal(rest.length, 0);
  assert.equal(f.severity, "error");
  assert.equal(f.line, 3);
  assert.equal(f.fix?.newText, "docs/guides/api-conventions.md");
});

test("dead-import: imports resolve relative to the importing file, not the root", () => {
  const dir = workspace({
    "CLAUDE.md": "See @packages/web/CLAUDE.md for the frontend.\n",
    "packages/web/CLAUDE.md": "Components follow @conventions.md\n",
    "packages/web/conventions.md": "# conventions\n",
  });
  assert.deepEqual(of(scan(dir), "dead-import"), []);
});

test("dead-import: code spans, fences, comments and frontmatter are not imports", () => {
  const lines = [
    "---",
    "note: @frontmatter/gone.md",
    "---",
    "Mention it literally as `@docs/gone.md` without importing it.",
    "```",
    "@fenced/gone.md",
    "```",
    "<!-- @comment/gone.md -->",
    "Real one: @docs/real.md",
  ];
  assert.deepEqual(extractImports(lines).map((i) => i.target), ["docs/real.md"]);
});

test("dead-import: mentions, packages, versions and emails are not path claims", () => {
  const dir = workspace({
    "CLAUDE.md": [
      "Ask @alice before touching billing.",
      "We depend on @types/node and @anthropic-ai/sdk.",
      "Pin the action to @1.2.3.",
      "Mail ops@example.com for access.",
    ].join("\n"),
  });
  assert.deepEqual(of(scan(dir), "dead-import"), []);
});

test("dead-import: backslash-escaped spaces are part of the path, as documented", () => {
  const dir = workspace({
    "CLAUDE.md": "- API conventions @Design\\ Docs/api-conventions.md\n",
    "Design Docs/api-conventions.md": "# api\n",
  });
  assert.deepEqual(of(scan(dir), "dead-import"), []);
});

test("dead-import: the fifth hop never loads", () => {
  const dir = workspace({
    "CLAUDE.md": "@a.md\n",
    "a.md": "@b.md\n",
    "b.md": "@c.md\n",
    "c.md": "@d.md\n",
    "d.md": "@e.md\n",
    "e.md": "the rule nobody ever sees\n",
  });
  const findings = of(scan(dir), "dead-import");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "d.md");
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /5 imports deep/);
});

// ------------------------------------------------------------------ dead-glob

test("dead-glob: a rule scoped to files the repo doesn't have never loads", () => {
  const dir = workspace({
    ".claude/rules/python.md": '---\npaths:\n  - "**/*.py"\n---\n# Python rules\n',
    "src/app.ts": "export {};\n",
  });
  const [f] = of(scan(dir), "dead-glob");
  assert.ok(f, "expected a dead-glob finding");
  assert.equal(f.line, 2);
  assert.match(f.message, /Claude Code/);
});

test("dead-glob: a glob that matches stays silent, braces included", () => {
  const dir = workspace({
    ".claude/rules/web.md": '---\npaths: "src/**/*.{ts,tsx}"\n---\n# web\n',
    "src/ui/Button.tsx": "export {};\n",
  });
  assert.deepEqual(of(scan(dir), "dead-glob"), []);
});

test("dead-glob: a Cursor-style `globs:` in a Claude rule is ignored — the rule loads everywhere", () => {
  const dir = workspace({
    ".claude/rules/api.md": '---\nglobs: "src/api/**"\n---\n# api\n',
    "src/api/users.ts": "export {};\n",
  });
  const [f] = of(scan(dir), "silent-config");
  assert.ok(f);
  assert.match(f.message, /reads only `paths:`/);
  assert.deepEqual(f.fix && { oldText: f.fix.oldText, newText: f.fix.newText }, { oldText: "globs:", newText: "paths:" });
});

test("dead-glob: Cursor alwaysApply rules and non-glob Kiro/Windsurf modes are not judged by their globs", () => {
  const dir = workspace({
    ".cursor/rules/always.mdc": "---\nglobs: \"**/*.py\"\nalwaysApply: true\n---\nrule\n",
    ".kiro/steering/manual.md": "---\ninclusion: manual\nfileMatchPattern: \"**/*.py\"\n---\nrule\n",
    ".windsurf/rules/model.md": "---\ntrigger: model_decision\nglobs: \"**/*.py\"\n---\nrule\n",
    "src/app.ts": "export {};\n",
  });
  assert.deepEqual(of(scan(dir), "dead-glob"), []);
});

// live rules alongside, so the three dead ones stay below the collapse ratio
const LIVE_RULES = {
  ".claude/rules/ts.md": '---\npaths: "src/**/*.ts"\n---\nts\n',
  ".github/instructions/ts.instructions.md": '---\napplyTo: "**/*.ts"\n---\nts\n',
  ".cursor/rules/ts.mdc": '---\nglobs: "src/**"\n---\nts\n',
  ".kiro/steering/ts.md": '---\ninclusion: fileMatch\nfileMatchPattern: "**/*.ts"\n---\nts\n',
};

test("dead-glob: Copilot applyTo, Kiro fileMatch and Windsurf glob triggers are all checked", () => {
  const dir = workspace({
    ...LIVE_RULES,
    ".github/instructions/go.instructions.md": '---\napplyTo: "**/*.go"\n---\nGo rules\n',
    ".kiro/steering/rust.md": '---\ninclusion: fileMatch\nfileMatchPattern: ["**/*.rs"]\n---\nRust\n',
    ".windsurf/rules/java.md": "---\ntrigger: glob\nglobs: \"**/*.java\"\n---\nJava\n",
    "src/app.ts": "export {};\n",
  });
  const agents = of(scan(dir), "dead-glob").map((f) => f.message.split(" loads")[0]).sort();
  assert.deepEqual(agents, ["GitHub Copilot", "Kiro", "Windsurf/Devin"]);
});

// Found on a real app-builder kit: 7 of its 11 rules targeted files only the
// projects it generates would have. Seven warnings said one thing.
test("dead-glob: when most scoped rules match nothing, they collapse into one note", () => {
  const dir = workspace({
    ".claude/rules/dart.md": '---\npaths: "lib/**/*.dart"\n---\nx\n',
    ".claude/rules/swift.md": '---\npaths: "ios/**/*.swift"\n---\nx\n',
    ".claude/rules/kotlin.md": '---\npaths: "android/**/*.kt"\n---\nx\n',
    ".claude/rules/docs.md": '---\npaths: "docs/**"\n---\nx\n',
    "docs/readme.md": "# docs\n",
  });
  const findings = of(scan(dir), "dead-glob");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /3 of 4 path-scoped rules/);
  assert.match(findings[0].hint ?? "", /dart\.md/);
});

test("dead-glob: globs into unwalked build output and unsupported syntax are left alone", () => {
  const dir = workspace({
    ".claude/rules/dist.md": '---\npaths: "dist/**/*.js"\n---\nx\n',
    ".claude/rules/ext.md": '---\npaths: "+(src|lib)/**/*.py"\n---\nx\n',
    "src/app.ts": "export {};\n",
  });
  assert.deepEqual(of(scan(dir), "dead-glob"), []);
});

// ------------------------------------------------------ AGENTS.md load order

const AGENTS_BODY = [
  "# Agents",
  "- Run the integration suite against the staging database before merging.",
  "- Never import from the legacy billing package; use the new ledger module.",
  "- Feature flags live in the remote config service, not in environment variables.",
  "- All public endpoints need an OpenAPI description before review.",
].join("\n");

test("load order: AGENTS.md next to a CLAUDE.md that doesn't carry its content is never read", () => {
  const dir = workspace({
    "CLAUDE.md": "# Claude\n\n- Use plan mode for anything touching payments or refunds.\n",
    "AGENTS.md": AGENTS_BODY,
  });
  const [f] = of(scan(dir), "silent-config");
  assert.ok(f);
  assert.equal(f.file, "AGENTS.md");
  assert.match(f.message, /never reads this file/);
  assert.match(f.hint ?? "", /@AGENTS\.md/);
});

test("load order: identical copies, an @AGENTS.md import, or a twins mirror lose Claude nothing", () => {
  for (const claude of [AGENTS_BODY, "@AGENTS.md\n\n## Claude\n- plan mode for payments\n"]) {
    const dir = workspace({ "CLAUDE.md": claude, "AGENTS.md": AGENTS_BODY });
    assert.deepEqual(of(scan(dir), "silent-config"), [], claude.slice(0, 20));
  }
});

test("load order: a CLAUDE.local.md alone silently switches AGENTS.md off on this machine", () => {
  const dir = workspace({ "CLAUDE.local.md": "- my sandbox is at localhost:4000\n", "AGENTS.md": AGENTS_BODY });
  const [f] = of(scan(dir), "silent-config");
  assert.ok(f);
  assert.equal(f.file, "CLAUDE.local.md");
  assert.match(f.message, /on this machine/);
});

test("load order: 'read AGENTS.md' in words is flagged at the sentence, once", () => {
  const dir = workspace({
    "CLAUDE.md": "# Claude\n\nBefore anything else, read AGENTS.md for the project rules.\n",
    "AGENTS.md": AGENTS_BODY,
  });
  const findings = of(scan(dir), "silent-config");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "CLAUDE.md");
  assert.equal(findings[0].line, 3);
});

test("load order: a root CLAUDE.md hides every nested AGENTS.md below it", () => {
  const dir = workspace({
    "CLAUDE.md": "# Monorepo\n\n- Use pnpm workspaces; never npm install in a package.\n",
    "packages/billing/AGENTS.md": AGENTS_BODY,
  });
  const [f] = of(scan(dir), "silent-config");
  assert.ok(f);
  assert.equal(f.file, "packages/billing/AGENTS.md");
  assert.match(f.hint ?? "", /@packages\/billing\/AGENTS\.md/);
});

// Each of these was a false positive on a real repository before it was excluded.
test("load order: templates, examples, skill bundles and container payloads are not project instructions", () => {
  const dir = workspace({
    "CLAUDE.md": "# Repo\n\n- Use pnpm workspaces; never npm install in a package.\n",
    "packages/create-app/template-common/AGENTS.md": AGENTS_BODY,
    "examples/hello-world/AGENTS.md": AGENTS_BODY,
    ".agents/skills/react-best-practices/AGENTS.md": AGENTS_BODY,
    "docker/config/workspace/AGENTS.md": AGENTS_BODY,
  });
  assert.deepEqual(of(scan(dir), "silent-config"), []);
});

test("load order: a nested AGENTS.md that CLAUDE.md names by path is a deliberate on-demand pointer", () => {
  const dir = workspace({
    "CLAUDE.md": "# Repo\n\nSee `openspec/AGENTS.md` for details on creating proposals.\n",
    "openspec/AGENTS.md": AGENTS_BODY,
  });
  assert.deepEqual(of(scan(dir), "silent-config"), [], "neither the pointer sentence nor the file is a finding");
});

test("load order: several hidden AGENTS.md files under one CLAUDE.md are reported once, on the CLAUDE.md", () => {
  const dir = workspace({
    "CLAUDE.md": "# Repo\n\n- Use plan mode for payments.\n",
    "AGENTS.md": AGENTS_BODY,
    "src/AGENTS.md": AGENTS_BODY.replace("staging", "preview"),
    "native/AGENTS.md": AGENTS_BODY.replace("staging", "device"),
  });
  const findings = of(scan(dir), "silent-config");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "CLAUDE.md");
  assert.match(findings[0].message, /none of the 3 AGENTS\.md files/);
});

test("load order: with no CLAUDE.md anywhere, AGENTS.md loads and nothing is said", () => {
  const dir = workspace({ "AGENTS.md": AGENTS_BODY, "packages/x/AGENTS.md": AGENTS_BODY });
  assert.deepEqual(of(scan(dir), "silent-config"), []);
});

test("load order: the SessionStart workaround now double-loads — but only when Claude reads AGENTS.md itself", () => {
  const settings = JSON.stringify({
    hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "cat AGENTS.md" }] }] },
  });
  const withoutClaude = workspace({ "AGENTS.md": AGENTS_BODY, ".claude/settings.json": settings });
  const [f] = of(scan(withoutClaude), "load-budget");
  assert.ok(f);
  assert.equal(f.severity, "info");
  const withClaude = workspace({ "AGENTS.md": AGENTS_BODY, "CLAUDE.md": "@AGENTS.md\n", ".claude/settings.json": settings });
  assert.deepEqual(of(scan(withClaude), "load-budget").filter((x) => /SessionStart/.test(x.message)), []);
});

// ------------------------------------------------------------- new surfaces

test("surfaces: Windsurf/Devin rule files past 12,000 characters", () => {
  const big = `# rules\n${"- keep handlers thin and push logic into services.\n".repeat(300)}`;
  const dir = workspace({ ".devin/rules/big.md": big, ".windsurf/rules/small.md": "# small\n" });
  const result = scan(dir);
  assert.ok(result.contextFiles.includes(".devin/rules/big.md"));
  assert.ok(result.contextFiles.includes(".windsurf/rules/small.md"));
  const budget = of(result, "load-budget");
  assert.equal(budget.length, 1);
  assert.equal(budget[0].file, ".devin/rules/big.md");
});

test("surfaces: Kiro #[[file:…]] references are path claims", () => {
  const dir = workspace({
    ".kiro/steering/api.md": "# API\n\nFollow #[[file:api/openapi.yaml]] and #[[file:api/gone.yaml]].\n",
    "api/openapi.yaml": "openapi: 3.1.0\n",
  });
  const dead = of(scan(dir), "dead-path");
  assert.equal(dead.length, 1);
  assert.match(dead[0].message, /api\/gone\.yaml/);
});

test("surfaces: .cursorrules, Junie, Continue and Copilot prompt files are scanned", () => {
  const dir = workspace({
    ".cursorrules": "Entry is `src/main.ts`.\n",
    ".junie/guidelines.md": "# g\n",
    ".continue/rules/style.md": "# s\n",
    ".github/prompts/review.prompt.md": "# r\n",
  });
  const r = scan(dir);
  for (const p of [".cursorrules", ".junie/guidelines.md", ".continue/rules/style.md", ".github/prompts/review.prompt.md"]) {
    assert.ok(r.contextFiles.includes(p), p);
  }
  assert.equal(of(r, "dead-path").length, 1, "the dead path in .cursorrules is reported");
});

// ------------------------------------------------------------- CI formats

import { toAzureLogging, toGithubAnnotations, toGitlabCodeQuality } from "../dist/ci.js";
import { spawnSync } from "node:child_process";

const fake = (findings) => ({ root: ".", contextFiles: [], findings, stats: { refsChecked: 0, refsBroken: 0, score: 100 } });
const tricky = {
  rule: "dead-path",
  severity: "error",
  file: "docs/a,b:c.md",
  line: 3,
  message: "100% gone; see [x]\nnext",
};

test("ci: GitHub annotations escape data and properties, map info to notice, omit line 0", () => {
  const out = toGithubAnnotations(fake([tricky, { ...tricky, severity: "info", line: 0 }])).split("\n");
  assert.equal(out[0], "::error file=docs/a%2Cb%3Ac.md,line=3,title=driftlint dead-path::100%25 gone; see [x]%0Anext");
  assert.ok(out[1].startsWith("::notice file=docs/a%2Cb%3Ac.md,title="), "no line= for a file-level finding");
});

test("ci: GitLab Code Quality is valid, maps severity, and keeps fingerprints stable when lines move", () => {
  const a = JSON.parse(toGitlabCodeQuality(fake([tricky, { ...tricky, severity: "warning", line: 0 }])));
  assert.equal(a[0].severity, "major");
  assert.equal(a[1].severity, "minor");
  assert.equal(a[1].location.lines.begin, 1, "GitLab requires begin >= 1");
  const moved = JSON.parse(toGitlabCodeQuality(fake([{ ...tricky, line: 40 }])));
  assert.equal(moved[0].fingerprint, a[0].fingerprint);
});

test("ci: Azure logging commands escape ; ] % and newlines, and leave info as a plain line", () => {
  const out = toAzureLogging(fake([tricky, { ...tricky, severity: "info" }])).split("\n");
  assert.equal(
    out[0],
    "##vso[task.logissue type=error;sourcepath=docs/a,b:c.md;linenumber=3;code=dead-path]100%AZP25 gone%3B see [x%5D%0Anext",
  );
  assert.ok(!out[1].startsWith("##vso"), "logissue has no info level");
});

test("ci: --format rejects an unknown name and refuses to combine with --fix", () => {
  const cli = new URL("../dist/cli.js", import.meta.url).pathname;
  const dir = workspace({ "CLAUDE.md": "# x\n" });
  assert.equal(spawnSync(process.execPath, [cli, dir, "--format", "junit"]).status, 2);
  assert.equal(spawnSync(process.execPath, [cli, dir, "--format", "github", "--fix"]).status, 2);
});
