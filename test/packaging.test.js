import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/** Numeric semver compare, enough for our own version strings. */
function cmp(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Does `version` satisfy a range built from `>=`, `<`, `<=` and `^` clauses? */
function satisfies(version, range) {
  return range
    .trim()
    .split(/\s+/)
    .every((clause) => {
      const m = /^(\^|>=|<=|>|<)?(\d+\.\d+\.\d+)$/.exec(clause);
      if (!m) return false;
      const [, op = "=", target = "0.0.0"] = m;
      if (op === "^") {
        // caret on 0.x only allows the same minor
        const [maj, min] = target.split(".").map(Number);
        const upper = maj === 0 ? `0.${(min ?? 0) + 1}.0` : `${maj + 1}.0.0`;
        return cmp(version, target) >= 0 && cmp(version, upper) < 0;
      }
      const c = cmp(version, target);
      if (op === ">=") return c >= 0;
      if (op === ">") return c > 0;
      if (op === "<=") return c <= 0;
      if (op === "<") return c < 0;
      return c === 0;
    });
}

// The MCP server is published separately, so its pin silently goes stale: a
// `^0.12.0` left behind during a 0.14 release makes `npx driftlint-mcp` install
// a two-release-old engine, with none of the rules the README advertises.
test("the MCP package's engine pin covers the version this repo ships", () => {
  const engine = read("package.json").version;
  const pin = read("mcp/package.json").dependencies["@alifurkangokce/driftlint"];
  assert.ok(
    satisfies(engine, pin),
    `mcp/package.json pins "${pin}", which excludes the engine this repo ships (${engine}) — bump the range and the mcp version before publishing.`,
  );
});

test("the range grammar the pin check relies on behaves", () => {
  assert.ok(satisfies("0.14.1", ">=0.14.1 <1.0.0"));
  assert.ok(!satisfies("0.14.1", "^0.12.0"), "caret on 0.x must not span minors");
  assert.ok(satisfies("0.12.9", "^0.12.0"));
  assert.ok(!satisfies("1.0.0", ">=0.14.1 <1.0.0"));
});

// The plugin manifest is published through a directory that shows its version
// to people deciding whether to install. It sat at 0.1.0 through eighteen
// releases, because nothing read it on the way out.
test("the plugin manifest carries the version this repo ships", () => {
  const engine = read("package.json").version;
  const plugin = read("plugins/driftlint/.claude-plugin/plugin.json").version;
  assert.equal(
    plugin,
    engine,
    `plugins/driftlint/.claude-plugin/plugin.json says ${plugin} but this repo ships ${engine} — the directory listing would advertise the wrong version.`,
  );
});

// Anthropic's plugin directory rejects a plugin that runs a package without an
// exact version — `npx pkg` or `pkg@latest` can change after review. So every
// place this repo *executes* itself names the version it ships, and this test
// is what keeps those pins from drifting across releases.
// The plugin lives in its own directory so the reviewed surface is the plugin
// alone — not this repo's contributor CLAUDE.md, README or test fixtures.
const PLUGIN_DIR = "plugins/driftlint";
const EXECUTING_FILES = [
  ...fs.readdirSync(path.join(ROOT, PLUGIN_DIR, "commands")).map((f) => `${PLUGIN_DIR}/commands/${f}`),
  "action.yml",
];
const LAUNCHER_DOCS = ["README.md", "mcp/README.md"]; // only their `claude mcp add` lines persist into config

function invocations(text) {
  return [...text.matchAll(/@alifurkangokce\/driftlint(-mcp)?(@[^\s`"')]+)?/g)].map((m) => ({
    pkg: m[1] ? "mcp" : "engine",
    version: m[2]?.slice(1),
    raw: m[0],
  }));
}

test("everything the plugin and the Action execute names an exact, current version", () => {
  const engine = read("package.json").version;
  const mcp = read("mcp/package.json").version;
  for (const rel of EXECUTING_FILES) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(!/@latest\b/.test(text), `${rel} runs @latest`);
    assert.ok(!/github:alifurkangokce\/driftlint(?!#v\d)/.test(text), `${rel} runs an unpinned github: source`);
    for (const inv of invocations(text)) {
      const want = inv.pkg === "mcp" ? mcp : engine;
      assert.equal(inv.version, want, `${rel}: \`${inv.raw}\` must be pinned to ${want}`);
    }
  }
});

test("documented MCP launchers pin the published server version", () => {
  const mcp = read("mcp/package.json").version;
  for (const rel of LAUNCHER_DOCS) {
    for (const line of fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n")) {
      if (!/claude mcp add/.test(line)) continue;
      const [inv] = invocations(line).filter((i) => i.pkg === "mcp");
      assert.ok(inv, `${rel}: launcher line names no driftlint-mcp package: ${line}`);
      assert.equal(inv.version, mcp, `${rel}: \`${line.trim()}\` must pin driftlint-mcp@${mcp}`);
    }
  }
});
