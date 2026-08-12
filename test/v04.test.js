import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvidence, runLlmPass } from "../dist/llm.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => path.join(FIXTURES, name);

const usage = { inputTokens: 10, outputTokens: 5 };

test("llm: buildEvidence greps keywords into file:line snippets", () => {
  const snippets = buildEvidence(fixture("multi"), ["src/thing.ts", "package.json"], ["thing"]);
  assert.ok(snippets.length >= 1, JSON.stringify(snippets));
  assert.match(snippets[0], /^src\/thing\.ts:1: /);
});

test("llm: contradicted claims become narrative-claim warnings; others are skipped", async () => {
  let call = 0;
  const complete = async (_system, _user, _schema) => {
    call++;
    if (call === 1) {
      return {
        data: {
          claims: [
            { claim: "The helper lives in src/thing.ts", line: 3, keywords: ["thing"] },
            { claim: "The project uses PostgreSQL", line: 4, keywords: ["postgres"] },
            { claim: "Something vague", line: 5, keywords: ["vague"] },
          ],
        },
        usage,
      };
    }
    if (call === 2) {
      return {
        data: {
          verdicts: [
            { index: 0, verdict: "supported", explanation: "matches" },
            { index: 1, verdict: "contradicted", explanation: "no database in use; scripts use plain files" },
            { index: 2, verdict: "unverifiable", explanation: "no evidence" },
          ],
        },
        usage,
      };
    }
    return { data: { claims: [] }, usage };
  };

  const pass = await runLlmPass(fixture("multi"), { complete });
  assert.equal(pass.claimsChecked, 3);
  assert.equal(pass.findings.length, 1, JSON.stringify(pass.findings));
  const f = pass.findings[0];
  assert.equal(f.rule, "narrative-claim");
  assert.equal(f.severity, "warning");
  assert.equal(f.line, 4);
  assert.match(f.message, /PostgreSQL/);
  assert.match(f.hint, /LLM-verified/);
  assert.ok(pass.usage.inputTokens >= 20, "usage should accumulate across calls");
});

test("llm: refusal/null data skips the file gracefully", async () => {
  const complete = async () => ({ data: null, usage });
  const pass = await runLlmPass(fixture("multi"), { complete });
  assert.equal(pass.findings.length, 0);
  assert.equal(pass.claimsChecked, 0);
  assert.ok(pass.filesChecked >= 1);
});

test("llm: ignore globs from config exclude context files", async () => {
  const calls = [];
  const complete = async (_s, user) => {
    calls.push(user.split("\n")[0]);
    return { data: { claims: [] }, usage };
  };
  await runLlmPass(fixture("multi"), { complete, config: { ignore: ["GEMINI.md"] } });
  assert.ok(
    !calls.some((c) => c.includes("GEMINI.md")),
    `GEMINI.md should be ignored: ${JSON.stringify(calls)}`,
  );
});
