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
