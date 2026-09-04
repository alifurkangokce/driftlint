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
