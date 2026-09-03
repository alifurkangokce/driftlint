#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { applyBaseline, applyRuleOverrides, loadBaseline, loadConfig, scan, writeBaseline } from "./scan.js";
import { createAnthropicComplete, DEFAULT_LLM_MODEL, runLlmPass } from "./llm.js";
import { printJson, printReport } from "./report.js";
import { toSarif } from "./sarif.js";
import { toRdjsonl } from "./rdjsonl.js";
import { diffScan } from "./diff.js";
import { applyFixes } from "./fix.js";
import { badgeJson } from "./badge.js";

const HELP = `driftlint — finds the claims in your CLAUDE.md / AGENTS.md / skills that your code no longer supports.

Usage:
  driftlint [path] [options]
  driftlint memory <propose|review|list|sync>   Reviewed Memory: agents propose,
                       humans approve, \`sync\` writes the approved set into
                       CLAUDE.md/AGENTS.md/GEMINI.md as a verified block
  driftlint memory audit [--repo <path>] [--dir <memory-dir>] [--json]
                       verify Claude Code auto-memory (~/.claude/projects/…/memory)
                       against the repo it describes: dead paths/commands in
                       memories, broken [[links]], MEMORY.md past the 200-line
                       fold that never loads
  driftlint twins [dir] [--source <file>] [--check]
                       mirror AGENTS.md into CLAUDE.md (or the reverse) as a
                       marked block, so Claude Code and Codex/Amp/Cursor read
                       the same instructions; --check fails CI when the mirror
                       is stale (the anthropics/claude-code#6235 problem)

Options:
  --json               machine-readable output
  --sarif              SARIF 2.1.0 output (pipe to a file, upload to GitHub code scanning)
  --rdjsonl            reviewdog RDFormat output with one-click Apply-suggestion payloads:
                       driftlint --rdjsonl | reviewdog -f=rdjsonl -reporter=github-pr-review -filter-mode=nofilter
  --fix                interactively apply safe fixes (single did-you-mean candidates);
                       --yes applies them all without asking
  --llm                also verify narrative claims ("auth goes through the BFF") against
                       the code, using YOUR Anthropic credentials (ANTHROPIC_API_KEY or an
                       \`ant auth login\` profile) and the optional @anthropic-ai/sdk package
  --llm-model <id>     model for --llm (default ${DEFAULT_LLM_MODEL}; claude-haiku-4-5 is the budget option)
  --diff [range]       report only drift THIS change caused: scans the merge-base in a
                       temp worktree, diffs findings, and attributes renames/deletes
                       (default range origin/main...HEAD)
  --no-fail            always exit 0, even with errors
  --badge-json <path>  also write a shields.io endpoint-badge JSON with the 0-100
                       context-freshness score (share of path references that resolve)
  --skill-budget <n>   system-prompt char budget for skill descriptions (default 15000)
  --update-baseline    record current findings in .driftlint-baseline.json and exit;
                       later runs only report findings NOT in the baseline
  --version            print version
  --help               this text

Checks:
  dead-path          referenced files/dirs that no longer exist (with "did you mean" hints)
  dead-command       npm scripts / make targets that were removed (workspace-aware)
  skill-budget       skills whose descriptions overflow the system-prompt budget (silently invisible)
  stale-knowledge    context files untouched for months while the code they describe churned
  foreign-context    a file whose references mostly don't resolve — probably describes another repo
  template-context   workflow files that describe a project this repo GENERATES (collapsed)
  load-budget        content past a harness limit (AGENTS.md 32KB, ~150-instruction adherence)
  missing-rationale  strong directives with no stated reason — the rules nobody dares delete
  twin-drift         CLAUDE.md and AGENTS.md that carry the same instructions but diverged
                     (unbridged near-copies, differing command claims, stale twins mirror)
  untracked-context  context files git doesn't track — your agent sees them, your team's don't
  dead-link          markdown links to files that moved or #anchors that were renamed
  silent-config      config the tool ignores (.cursor/rules/*.md, misplaced skills)
  dead-config-ref    hooks/MCP/plugin/skill config pointing at scripts that don't exist
  narrative-claim    (--llm only) narrative claims the code contradicts

Config (.driftlintrc.json at the scanned root):
  { "skillBudget": 15000, "ignore": ["docs/archive/**"], "rules": { "dead-command": "off" } }

Ignore a line with a "driftlint-ignore" comment on it or the line above.`;

interface Options {
  root: string;
  json: boolean;
  sarif: boolean;
  rdjsonl: boolean;
  fix: boolean;
  yes: boolean;
  fail: boolean;
  updateBaseline: boolean;
  diff?: string;
  badgeJsonPath?: string;
  llm: boolean;
  llmModel?: string;
  skillBudget?: number;
}

function parseArgs(argv: string[]): Options | "help" | "version" {
  const opts: Options = {
    root: ".",
    json: false,
    sarif: false,
    rdjsonl: false,
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
    else if (a === "--rdjsonl") opts.rdjsonl = true;
    else if (a === "--fix") opts.fix = true;
    else if (a === "--yes") opts.yes = true;
    else if (a === "--no-fail") opts.fail = false;
    else if (a === "--update-baseline") opts.updateBaseline = true;
    else if (a === "--diff") {
      const next = argv[i + 1];
      opts.diff = next && !next.startsWith("-") ? (i++, next) : "origin/main...HEAD";
    }
    else if (a === "--badge-json") {
      const p = argv[++i];
      if (!p || p.startsWith("-")) {
        console.error("driftlint: --badge-json expects a file path");
        process.exit(2);
      }
      opts.badgeJsonPath = p;
    }
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
  if (process.argv[2] === "memory") {
    const { runMemoryCli } = await import("./memory.js");
    process.exit(await runMemoryCli(process.argv.slice(3)));
  }
  if (process.argv[2] === "twins") {
    const { runTwinsCli } = await import("./twins.js");
    process.exit(runTwinsCli(process.argv.slice(3)));
  }
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
  if (parsed.fix && (parsed.json || parsed.sarif || parsed.rdjsonl)) {
    console.error("driftlint: --fix cannot be combined with --json/--sarif/--rdjsonl");
    process.exit(2);
  }

  if (parsed.diff && parsed.updateBaseline) {
    console.error("driftlint: --diff and --update-baseline cannot be combined");
    process.exit(2);
  }

  let result;
  if (parsed.diff) {
    try {
      const d = diffScan(root, parsed.diff, { skillBudget: parsed.skillBudget });
      console.error(
        `driftlint --diff: baseline ${d.baselineRef.slice(0, 10)} — ${d.findings.length} new finding${d.findings.length === 1 ? "" : "s"}, ${d.suppressed} pre-existing hidden`,
      );
      result = d;
    } catch (e) {
      console.error(
        `driftlint --diff: could not resolve "${parsed.diff}" (${(e as Error).message.split("\n")[0]}). Fetch the base branch (git fetch origin main) or pass an explicit range, e.g. --diff main...HEAD`,
      );
      process.exit(2);
    }
  } else {
    result = scan(root, { skillBudget: parsed.skillBudget });
  }

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

  if (parsed.badgeJsonPath) {
    fs.writeFileSync(
      parsed.badgeJsonPath,
      `${JSON.stringify(badgeJson(result.stats.score, result.stats.refsChecked))}\n`,
    );
    console.error(`driftlint: badge JSON written to ${parsed.badgeJsonPath} (score ${result.stats.score}%)`);
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
  } else if (parsed.rdjsonl) {
    const out = toRdjsonl(result);
    if (out) console.log(out);
  } else if (parsed.json) {
    printJson(result);
  } else {
    printReport(result);
  }

  const errors = result.findings.some((f) => f.severity === "error");
  process.exit(parsed.fail && errors ? 1 : 0);
}

void main();
