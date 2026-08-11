#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { buildIndex, walk } from "./fswalk.js";
import { discoverContextFiles } from "./discover.js";
import { extractRefs } from "./extract.js";
import { checkDeadPaths } from "./checks/deadPaths.js";
import { checkDeadCommands } from "./checks/deadCommands.js";
import { checkSkillBudget } from "./checks/skillBudget.js";
import { checkFreshness } from "./checks/freshness.js";
import { printJson, printReport } from "./report.js";
import type { Finding, ScanResult } from "./types.js";

const HELP = `driftlint — finds the claims in your CLAUDE.md / AGENTS.md / skills that your code no longer supports.

Usage:
  driftlint [path] [options]

Options:
  --json               machine-readable output
  --no-fail            always exit 0, even with errors
  --skill-budget <n>   system-prompt char budget for skill descriptions (default 15000)
  --version            print version
  --help               this text

Checks:
  dead-path        referenced files/dirs that no longer exist (with "did you mean" hints)
  dead-command     npm scripts / make targets that were removed or renamed
  skill-budget     skills whose descriptions overflow the system-prompt budget (silently invisible)
  stale-knowledge  context files untouched for months while the code they describe churned

Ignore a line with a "driftlint-ignore" comment on it or the line above.`;

interface Options {
  root: string;
  json: boolean;
  fail: boolean;
  skillBudget: number;
}

function parseArgs(argv: string[]): Options | "help" | "version" {
  const opts: Options = { root: ".", json: false, fail: true, skillBudget: 15_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return "help";
    if (a === "--version" || a === "-v") return "version";
    if (a === "--json") opts.json = true;
    else if (a === "--no-fail") opts.fail = false;
    else if (a === "--skill-budget") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(n) || n <= 0) {
        console.error("driftlint: --skill-budget expects a positive number");
        process.exit(2);
      }
      opts.skillBudget = n;
    } else if (a && !a.startsWith("-")) opts.root = a;
    else {
      console.error(`driftlint: unknown option ${a}\n`);
      console.error(HELP);
      process.exit(2);
    }
  }
  return opts;
}

export function scan(root: string, skillBudget: number): ScanResult {
  const entries = walk(root);
  const index = buildIndex(root, entries);
  const contextFiles = discoverContextFiles(root, entries);

  const findings: Finding[] = [];
  for (const file of contextFiles) {
    const { paths, commands } = extractRefs(file);
    findings.push(...checkDeadPaths(file, paths, index));
    findings.push(...checkDeadCommands(root, file, commands));
    findings.push(...checkFreshness(root, file, paths));
  }
  findings.push(...checkSkillBudget(contextFiles.filter((f) => f.kind === "skill"), skillBudget));

  return { root, contextFiles: contextFiles.map((f) => f.path), findings };
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === "help") {
    console.log(HELP);
    return;
  }
  if (parsed === "version") {
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    console.log(pkg.version);
    return;
  }

  const root = path.resolve(parsed.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`driftlint: ${parsed.root} is not a directory`);
    process.exit(2);
  }

  const result = scan(root, parsed.skillBudget);
  if (parsed.json) printJson(result);
  else printReport(result);

  const errors = result.findings.some((f) => f.severity === "error");
  process.exit(parsed.fail && errors ? 1 : 0);
}

main();
