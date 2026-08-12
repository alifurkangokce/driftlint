#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { applyBaseline, applyRuleOverrides, loadBaseline, loadConfig, scan, writeBaseline } from "./scan.js";
import { createAnthropicComplete, DEFAULT_LLM_MODEL, runLlmPass } from "./llm.js";
import { printJson, printReport } from "./report.js";
import { toSarif } from "./sarif.js";
import { applyFixes } from "./fix.js";

const HELP = `driftlint — finds the claims in your CLAUDE.md / AGENTS.md / skills that your code no longer supports.

Usage:
  driftlint [path] [options]

Options:
  --json               machine-readable output
  --sarif              SARIF 2.1.0 output (pipe to a file, upload to GitHub code scanning)
  --fix                interactively apply safe fixes (single did-you-mean candidates);
                       --yes applies them all without asking
  --llm                also verify narrative claims ("auth goes through the BFF") against
                       the code, using YOUR Anthropic credentials (ANTHROPIC_API_KEY or an
                       \`ant auth login\` profile) and the optional @anthropic-ai/sdk package
  --llm-model <id>     model for --llm (default ${DEFAULT_LLM_MODEL}; claude-haiku-4-5 is the budget option)
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
  sarif: boolean;
  fix: boolean;
  yes: boolean;
  fail: boolean;
  updateBaseline: boolean;
  llm: boolean;
  llmModel?: string;
  skillBudget?: number;
}

function parseArgs(argv: string[]): Options | "help" | "version" {
  const opts: Options = {
    root: ".",
    json: false,
    sarif: false,
    fix: false,
    yes: false,
    fail: true,
    updateBaseline: false,
    llm: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return "help";
    if (a === "--version" || a === "-v") return "version";
    if (a === "--json") opts.json = true;
    else if (a === "--sarif") opts.sarif = true;
    else if (a === "--fix") opts.fix = true;
    else if (a === "--yes") opts.yes = true;
    else if (a === "--no-fail") opts.fail = false;
    else if (a === "--update-baseline") opts.updateBaseline = true;
    else if (a === "--llm") opts.llm = true;
    else if (a === "--llm-model") {
      const m = argv[++i];
      if (!m || m.startsWith("-")) {
        console.error("driftlint: --llm-model expects a model id");
        process.exit(2);
      }
      opts.llmModel = m;
    }
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

function readVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return pkg.version;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === "help") {
    console.log(HELP);
    return;
  }
  if (parsed === "version") {
    console.log(readVersion());
    return;
  }

  const root = path.resolve(parsed.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`driftlint: ${parsed.root} is not a directory`);
    process.exit(2);
  }
  if (parsed.fix && (parsed.json || parsed.sarif)) {
    console.error("driftlint: --fix cannot be combined with --json/--sarif");
    process.exit(2);
  }

  let result = scan(root, { skillBudget: parsed.skillBudget });

  if (parsed.llm) {
    const model = parsed.llmModel ?? DEFAULT_LLM_MODEL;
    const config = loadConfig(root);
    try {
      const complete = await createAnthropicComplete(model);
      const pass = await runLlmPass(root, { complete, config });
      result.findings.push(...applyRuleOverrides(pass.findings, config));
      console.error(
        `driftlint --llm: ${pass.claimsChecked} claims across ${pass.filesChecked} files, ${pass.findings.length} contradicted (${model}, ${pass.usage.inputTokens} in / ${pass.usage.outputTokens} out tokens)`,
      );
    } catch (e) {
      console.error(`driftlint --llm: ${(e as Error).message}`);
      process.exit(2);
    }
  }

  if (parsed.updateBaseline) {
    const p = writeBaseline(root, result.findings);
    console.log(
      `driftlint: baseline written to ${path.relative(process.cwd(), p)} (${result.findings.length} findings recorded)`,
    );
    return;
  }

  const baseline = loadBaseline(root);
  if (baseline) result.findings = applyBaseline(result.findings, baseline);

  if (parsed.fix) {
    const { applied, skipped } = await applyFixes(root, result.findings, { yes: parsed.yes });
    result = scan(root, { skillBudget: parsed.skillBudget });
    if (baseline) result.findings = applyBaseline(result.findings, baseline);
    printReport(result);
    console.log(
      `driftlint --fix: ${applied.length} applied, ${skipped.length} skipped (re-scan above is the current state)`,
    );
  } else if (parsed.sarif) {
    console.log(JSON.stringify(toSarif(result, readVersion()), null, 2));
  } else if (parsed.json) {
    printJson(result);
  } else {
    printReport(result);
  }

  const errors = result.findings.some((f) => f.severity === "error");
  process.exit(parsed.fail && errors ? 1 : 0);
}

void main();
