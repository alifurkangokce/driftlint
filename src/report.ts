import { MIN_SCORED_REFS } from "./badge.js";
import type { Finding, ScanResult, Severity } from "./types.js";

const useColor = process.stdout.isTTY && !process.env["NO_COLOR"];
const c = (code: number, s: string): string => (useColor ? `[${code}m${s}[0m` : s);
const red = (s: string) => c(31, s);
const yellow = (s: string) => c(33, s);
const dim = (s: string) => c(2, s);
const bold = (s: string) => c(1, s);
const cyan = (s: string) => c(36, s);

const SEV_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function printReport(result: ScanResult): void {
  const byFile = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  for (const [file, findings] of [...byFile.entries()].sort()) {
    console.log(`\n${bold(cyan(file))}`);
    findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.line - b.line);
    for (const f of findings) {
      const loc = f.line > 0 ? dim(`:${f.line}`) : "";
      const tag =
        f.severity === "error" ? red("✗") : f.severity === "warning" ? yellow("⚠") : dim("ℹ");
      const fixable = f.fix ? dim(" ✎ fixable") : "";
      console.log(`  ${tag} ${dim(`[${f.rule}]`)}${loc} ${f.message}${fixable}`);
      if (f.hint) console.log(`      ${dim(`↳ ${f.hint}`)}`);
    }
  }

  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.filter((f) => f.severity === "warning").length;
  const infos = result.findings.filter((f) => f.severity === "info").length;

  console.log();
  if (result.contextFiles.length === 0) {
    console.log(dim("driftlint: no agent context files found (CLAUDE.md, AGENTS.md, .claude/skills, …)"));
    return;
  }
  const parts = [
    errors ? red(`${errors} error${errors === 1 ? "" : "s"}`) : "0 errors",
    warnings ? yellow(`${warnings} warning${warnings === 1 ? "" : "s"}`) : "0 warnings",
    infos ? `${infos} info` : null,
  ].filter(Boolean);
  console.log(
    `${bold("driftlint:")} ${parts.join(", ")} across ${result.contextFiles.length} context file${result.contextFiles.length === 1 ? "" : "s"}`,
  );
  if (result.stats.refsChecked >= MIN_SCORED_REFS) {
    console.log(
      dim(`context freshness: ${result.stats.score}% (${result.stats.refsChecked - result.stats.refsBroken}/${result.stats.refsChecked} path references resolve)`),
    );
  }
  if (errors === 0 && warnings === 0) {
    console.log(dim("your agent context files agree with your code. rare."));
  }
}

export function printJson(result: ScanResult): void {
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.filter((f) => f.severity === "warning").length;
  console.log(
    JSON.stringify(
      {
        root: result.root,
        contextFiles: result.contextFiles,
        stats: result.stats,
        summary: { errors, warnings, total: result.findings.length },
        findings: result.findings,
      },
      null,
      2,
    ),
  );
}
