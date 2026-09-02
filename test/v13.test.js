import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scan } from "../dist/scan.js";

function tmp(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-v13-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const of = (dir, rule) => scan(dir).findings.filter((f) => f.rule === rule);

// --- silent-config ---

test("silent-config: Cursor ignores plain .md rules; .mdc is fine", () => {
  const dir = tmp({
    ".cursor/rules/style.md": "Always use tabs.\n",
    ".cursor/rules/api.mdc": "---\ndescription: api rules\nglobs: src/**\nalwaysApply: false\n---\nUse zod.\n",
  });
  const found = of(dir, "silent-config");
  assert.equal(found.length, 1);
  assert.equal(found[0].file, ".cursor/rules/style.md");
  assert.equal(found[0].severity, "error");
  assert.match(found[0].hint, /\.mdc/);
});

test("silent-config: a bare .md under .claude/skills never loads", () => {
  const dir = tmp({
    ".claude/skills/deploy.md": "# Deploy\n",
    ".claude/skills/release/SKILL.md": "---\nname: release\ndescription: cut a release\n---\nSteps.\n",
  });
  const found = of(dir, "silent-config");
  assert.equal(found.length, 1);
  assert.equal(found[0].file, ".claude/skills/deploy.md");
  assert.match(found[0].hint, /\.claude\/skills\/deploy\/SKILL\.md/);
});

// --- dead-config-ref ---

test("dead-config-ref: a hook pointing at a missing script errors, an existing one is silent", () => {
  const dir = tmp({
    ".claude/settings.json": JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            { matcher: "Edit", hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh" }] },
          ],
          PostToolUse: [
            { matcher: "Write", hooks: [{ type: "command", command: "./scripts/format.sh" }] },
          ],
        },
      },
      null,
      2,
    ),
    ".claude/hooks/guard.sh": "#!/bin/sh\nexit 0\n",
  });
  const found = of(dir, "dead-config-ref");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /scripts\/format\.sh/);
  assert.ok(found[0].line > 0, "should point at the line in settings.json");
});

test("dead-config-ref: MCP local entry files are checked, remote packages are not", () => {
  const dir = tmp({
    ".mcp.json": JSON.stringify(
      {
        mcpServers: {
          local: { command: "node", args: ["${CLAUDE_PROJECT_DIR}/mcp/server.js"] },
          remote: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
          docker: { command: "docker", args: ["run", "-i", "ghcr.io/example/mcp:latest"] },
        },
      },
      null,
      2,
    ),
  });
  const found = of(dir, "dead-config-ref");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /mcp\/server\.js/);
});

test("dead-config-ref: plugin manifests resolve against the plugin root", () => {
  const dir = tmp({
    ".claude-plugin/plugin.json": JSON.stringify(
      { name: "demo", commands: ["./commands/ship.md", "./commands/gone.md"] },
      null,
      2,
    ),
    "commands/ship.md": "# ship\n",
  });
  const found = of(dir, "dead-config-ref");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /commands\/gone\.md/);
});

test("dead-config-ref: machine paths, unknown variables and globs are skipped", () => {
  const dir = tmp({
    ".claude/settings.json": JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: "/usr/local/bin/notify --title done" },
                { type: "command", command: "~/bin/personal.sh" },
                { type: "command", command: "$HOME/tools/thing.sh" },
                { type: "command", command: "${MY_DIR}/thing.sh" },
                { type: "command", command: "rm -f dist/*.log" },
                { type: "command", command: "jq -r '.tool_input.file_path'" },
              ],
            },
          ],
        },
        permissions: { allow: ["Bash(npm run test:*)"], deny: ["Read(./.env)"] },
      },
      null,
      2,
    ),
  });
  assert.deepEqual(of(dir, "dead-config-ref"), []);
});

test("dead-config-ref: a did-you-mean hint appears when the script moved", () => {
  const dir = tmp({
    ".claude/settings.json": JSON.stringify(
      { hooks: { Stop: [{ hooks: [{ type: "command", command: "./scripts/format.sh" }] }] } },
      null,
      2,
    ),
    "tools/format.sh": "#!/bin/sh\n",
  });
  const found = of(dir, "dead-config-ref");
  assert.equal(found.length, 1);
  assert.match(found[0].hint, /tools\/format\.sh/);
});

test("dead-config-ref: a skill's bundled script is verified via CLAUDE_SKILL_DIR", () => {
  const dir = tmp({
    ".claude/skills/chart/SKILL.md":
      "---\nname: chart\ndescription: render a chart\nallowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)\n---\nRun `${CLAUDE_SKILL_DIR}/scripts/render.sh` then show the png.\n",
    ".claude/skills/ok/SKILL.md":
      "---\nname: ok\ndescription: fine\n---\nRun `${CLAUDE_SKILL_DIR}/scripts/here.sh`.\n",
    ".claude/skills/ok/scripts/here.sh": "#!/bin/sh\n",
  });
  const found = of(dir, "dead-config-ref");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /\.claude\/skills\/chart\/scripts\/render\.sh/);
});

test("discovery: Cursor skills are Agent Skills too, so budget rules apply there", () => {
  const long = "y".repeat(1600);
  const dir = tmp({
    ".cursor/skills/review/SKILL.md": `---\nname: review\ndescription: ${long}\n---\nBody.\n`,
  });
  const result = scan(dir);
  assert.ok(result.contextFiles.includes(".cursor/skills/review/SKILL.md"), "should be discovered");
  const found = result.findings.filter((f) => f.rule === "skill-budget" && f.message.includes("truncates"));
  assert.equal(found.length, 1);
});

test("dead-link: ALL_CAPS fill-in markers are placeholders, not claims", () => {
  const dir = tmp({
    "CLAUDE.md": "# App\n\nTicket: [details](TFS_LINK) · docs: [guide](YOUR_DOC_URL)\n\nReal: [readme](README.md)\n",
    "README.md": "# Readme\n",
  });
  assert.deepEqual(of(dir, "dead-link"), []);
});

// --- skill listing cap (official 1,536-char truncation) ---

test("dead-config-ref: allow rules warn, deny/ask rules are left alone", () => {
  const dir = tmp({
    ".claude/settings.json": JSON.stringify(
      {
        permissions: {
          allow: ["Bash(./scripts/deploy.sh)"],
          deny: ["Read(./secrets/keys.json)"],
          ask: ["Bash(./scripts/danger.sh)"],
        },
      },
      null,
      2,
    ),
  });
  const found = of(dir, "dead-config-ref");
  assert.equal(found.length, 1, "only the allow rule counts");
  assert.equal(found[0].severity, "warning", "an allow rule is weaker evidence than a hook");
  assert.match(found[0].message, /scripts\/deploy\.sh/);
});

test("skill-budget: description + when_to_use past 1,536 chars warns about truncation", () => {
  const long = "x".repeat(1200);
  const dir = tmp({
    ".claude/skills/big/SKILL.md": `---\nname: big\ndescription: ${long}\nwhen_to_use: ${long}\n---\nBody.\n`,
    ".claude/skills/small/SKILL.md": "---\nname: small\ndescription: short and useful\n---\nBody.\n",
  });
  const found = of(dir, "skill-budget").filter((f) => f.message.includes("truncates"));
  assert.equal(found.length, 1);
  assert.equal(found[0].file, ".claude/skills/big/SKILL.md");
  assert.match(found[0].message, /1,?536/);
});
