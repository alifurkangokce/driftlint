import type { Finding, ScanResult } from "./types.js";

const RULE_DESCRIPTIONS: Record<Finding["rule"], string> = {
  "dead-path": "Referenced file or directory does not exist",
  "dead-command": "Referenced npm script or make target does not exist",
  "skill-budget": "Skill descriptions overflow the system-prompt budget",
  "stale-knowledge": "Context file untouched while the code it describes churned",
  "foreign-context": "Most path references do not resolve; file probably describes another repo",
  "narrative-claim": "A narrative claim in the context file appears contradicted by the code (LLM-verified)",
  "template-context": "File appears to describe a project this repo generates; path/command findings suppressed",
  "load-budget": "Content exceeds a harness load limit and may silently never reach the model",
  "missing-rationale": "Strong directives without a stated reason become unprunable over time",
  "twin-drift": "CLAUDE.md and AGENTS.md carry the same instructions but have diverged",
  "untracked-context": "Context file is not tracked by git; teammates and CI never see it",
};

const LEVEL: Record<Finding["severity"], "error" | "warning" | "note"> = {
  error: "error",
  warning: "warning",
  info: "note",
};

/** SARIF 2.1.0 — accepted by GitHub code scanning for PR annotations. */
export function toSarif(result: ScanResult, version: string): object {
  return {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "driftlint",
            version,
            informationUri: "https://github.com/alifurkangokce/driftlint",
            rules: Object.entries(RULE_DESCRIPTIONS).map(([id, text]) => ({
              id,
              shortDescription: { text },
              helpUri: "https://github.com/alifurkangokce/driftlint#what-it-checks",
            })),
          },
        },
        results: result.findings.map((f) => ({
          ruleId: f.rule,
          level: LEVEL[f.severity],
          message: { text: f.hint ? `${f.message} (${f.hint})` : f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file },
                region: { startLine: Math.max(f.line, 1) },
              },
            },
          ],
        })),
      },
    ],
  };
}
