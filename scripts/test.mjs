import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Node 20 does not expand quoted test globs. Enumerate explicitly so all
// supported Node versions and shells run the same suite, excluding fixtures.
const root = fileURLToPath(new URL("../", import.meta.url));
const files = readdirSync(new URL("../test/", import.meta.url))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => `test/${name}`);
const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
