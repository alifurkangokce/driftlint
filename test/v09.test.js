import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../dist/scan.js";
import { toRdjsonl } from "../dist/rdjsonl.js";
import { checkReference } from "../dist/reference.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (n) => path.join(ROOT, "test", "fixtures", n);
const MCP_SERVER = path.join(ROOT, "mcp", "dist", "server.js");

test("rdjsonl: diagnostics with column-precise Apply-suggestion payloads", () => {
  const r = scan(fixture("basic"), { skillBudget: 300 });
  const lines = toRdjsonl(r).split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, r.findings.length);

  const moved = lines.find((d) => d.message.includes("lib/util.ts"));
  assert.ok(moved, JSON.stringify(lines));
  assert.equal(moved.severity, "ERROR");
  assert.equal(moved.code.value, "dead-path");
  assert.ok(moved.suggestions?.length === 1, "did-you-mean must become a suggestion");
  const sug = moved.suggestions[0];
  assert.equal(sug.text, "src/util.ts");
  // sütun doğruluğu: önerilen aralık kaynak satırdaki oldText'i birebir kapsamalı
  const srcLine = fs.readFileSync(path.join(fixture("basic"), moved.location.path), "utf8").split(/\r?\n/)[
    moved.location.range.start.line - 1
  ];
  assert.equal(srcLine.slice(sug.range.start.column - 1, sug.range.end.column - 1), "lib/util.ts");
});

test("checkReference: paths and scripts verify with suggestions", () => {
  const root = fixture("basic");
  assert.deepEqual(checkReference(root, "src/app.ts"), { ok: true, kind: "path", suggestions: [] });
  const moved = checkReference(root, "lib/util.ts");
  assert.equal(moved.ok, false);
  assert.deepEqual(moved.suggestions, ["src/util.ts"]);
  assert.equal(checkReference(root, "build").ok, true);
  const gone = checkReference(root, "deploy:prod");
  assert.equal(gone.ok, false);
  assert.ok(gone.suggestions.includes("deploy"));
});

test("mcp: server answers initialize, lists tools, and drift_check works over stdio", { skip: !fs.existsSync(MCP_SERVER) && "mcp not built" }, async () => {
  const child = spawn(process.execPath, [MCP_SERVER], { stdio: ["pipe", "pipe", "pipe"] });
  const responses = new Map();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    }
  });
  const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
  const waitFor = (id) =>
    new Promise((resolve, reject) => {
      const t = setInterval(() => {
        if (responses.has(id)) {
          clearInterval(t);
          resolve(responses.get(id));
        }
      }, 25);
      setTimeout(() => {
        clearInterval(t);
        reject(new Error(`timeout waiting for response ${id}`));
      }, 10000);
    });

  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "driftlint-test", version: "0" } } });
    const init = await waitFor(1);
    assert.equal(init.result.serverInfo.name, "driftlint");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });

    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const tools = (await waitFor(2)).result.tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ["drift_check", "drift_scan"]);

    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "drift_check", arguments: { path: fixture("basic"), reference: "lib/util.ts" } } });
    const check = JSON.parse((await waitFor(3)).result.content[0].text);
    assert.equal(check.ok, false);
    assert.deepEqual(check.suggestions, ["src/util.ts"]);
  } finally {
    child.kill();
  }
});
