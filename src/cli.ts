#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { applyBaseline, loadBaseline, scan, writeBaseline } from "./scan.js";
import { printJson, printReport } from "./report.js";

const HELP = `driftlint — finds the claims in your CLAUDE.md / AGENTS.md / skills that your code no longer supports.

Usage:
  driftlint [path] [options]

Options:
  --json               machine-readable output
  --no-fail            always exit 0, even with errors
  --skill-budget <n>   system-prompt char budget for skill descriptions (default 15000)
  --update-baseline    record current findings in .driftlint-baseline.json and exit;
                       later runs only report findings NOT in the baseline
  --version            print version
  --help               this text

Checks:
  dead-path        referenced files/dirs that no longer exist (with "did you mean" hints)
  dead-command     npm scripts / make targets that were removed (workspace-aware)
  skill-budget     skills whose descriptions overflow the system-prompt budget (silently invisible)
  stale-knowledge  context files untouched for months while the code they describe churned
  foreign-context  a file whose references mostly don't resolve — probably describes another repo

Config (.driftlintrc.json at the scanned root):
  { "skillBudget": 15000, "ignore": ["docs/archive/**"], "rules": { "dead-command": "off" } }

Ignore a line with a "driftlint-ignore" comment on it or the line above.`;

interface Options {
  root: string;
  json: boolean;
  fail: boolean;
  updateBaseline: boolean;
  skillBudget?: number;
}

function parseArgs(argv: string[]): Options | "help" | "version" {
  const opts: Options = { root: ".", json: false, fail: true, updateBaseline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return "help";
    if (a === "--version" || a === "-v") return "version";
    if (a === "--json") opts.json = true;
    else if (a === "--no-fail") opts.fail = false;
    else if (a === "--update-baseline") opts.updateBaseline = true;
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

  const result = scan(root, { skillBudget: parsed.skillBudget });

  if (parsed.updateBaseline) {
    const p = writeBaseline(root, result.findings);
    console.log(
      `driftlint: baseline written to ${path.relative(process.cwd(), p)} (${result.findings.length} findings recorded)`,
    );
    return;
  }

  const baseline = loadBaseline(root);
  if (baseline) result.findings = applyBaseline(result.findings, baseline);

  if (parsed.json) printJson(result);
  else printReport(result);

  const errors = result.findings.some((f) => f.severity === "error");
  process.exit(parsed.fail && errors ? 1 : 0);
}

main();
