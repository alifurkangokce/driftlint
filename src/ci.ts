import { createHash } from "node:crypto";
import type { Finding, ScanResult } from "./types.js";

/**
 * Native annotation formats for the CI systems people actually run. SARIF
 * covers GitHub code scanning, but on private repositories that needs GitHub
 * Advanced Security; workflow commands annotate a PR anywhere, for free.
 */

const text = (f: Finding): string => (f.hint ? `${f.message} — ${f.hint}` : f.message);

// ---------------------------------------------------------------- GitHub
// https://docs.github.com/actions/reference/workflow-commands-for-github-actions
const ghData = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const ghProp = (s: string) => ghData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
const GH_LEVEL = { error: "error", warning: "warning", info: "notice" } as const;

export function toGithubAnnotations(result: ScanResult): string {
  return result.findings
    .map((f) => {
      const props = [`file=${ghProp(f.file)}`, ...(f.line > 0 ? [`line=${f.line}`] : []), `title=${ghProp(`driftlint ${f.rule}`)}`];
      return `::${GH_LEVEL[f.severity]} ${props.join(",")}::${ghData(text(f))}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------- GitLab
// https://docs.gitlab.com/ci/testing/code_quality/#code-quality-report-format
const GL_SEVERITY = { error: "major", warning: "minor", info: "info" } as const;

export function toGitlabCodeQuality(result: ScanResult): string {
  const issues = result.findings.map((f) => ({
    description: text(f),
    check_name: f.rule,
    // line numbers shift too easily to be identity — same rule as the baseline
    fingerprint: createHash("md5").update(`${f.rule}|${f.file}|${f.message}`).digest("hex"),
    severity: GL_SEVERITY[f.severity],
    location: { path: f.file, lines: { begin: Math.max(1, f.line) } },
  }));
  return JSON.stringify(issues, null, 2);
}

// ----------------------------------------------------------- Azure Pipelines
// https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands
const azEscape = (s: string) =>
  s.replace(/%/g, "%AZP25").replace(/;/g, "%3B").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/]/g, "%5D");

export function toAzureLogging(result: ScanResult): string {
  return result.findings
    .map((f) => {
      // logissue has only error and warning; an info note stays a plain line
      if (f.severity === "info") return `driftlint ${f.rule}: ${f.file}${f.line > 0 ? `:${f.line}` : ""} ${text(f)}`;
      const props = [
        `type=${f.severity}`,
        `sourcepath=${azEscape(f.file)}`,
        ...(f.line > 0 ? [`linenumber=${f.line}`] : []),
        `code=${f.rule}`,
      ];
      return `##vso[task.logissue ${props.join(";")}]${azEscape(text(f))}`;
    })
    .join("\n");
}
