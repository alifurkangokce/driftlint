import type { ContextFile, Finding } from "../types.js";

/**
 * Rules whose reason is lost are the ones nobody dares delete — context files
 * grow ~5 instructions per commit and almost never shrink for exactly this
 * reason (arXiv 2608.11095). One collapsed info per file, never a flood.
 */

const STRONG_DIRECTIVE = /\b(never|always|must(?: not)?|do(?:n'?t| not)|only ever)\b/i;
const RATIONALE = /\b(because|so that|otherwise|since|to (?:avoid|prevent|keep|ensure)|breaks?|caused|why:)\b|—/i;

const MAIN_KINDS = new Set(["claude-md", "agents-md", "gemini"]);
const MIN_DIRECTIVES = 5;
const MISSING_RATIO = 0.8;

export function checkRationale(files: ContextFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!MAIN_KINDS.has(file.kind)) continue;
    let directives = 0;
    let missing = 0;
    let inFence = false;
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? "";
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence || !/^\s*([-*+]\s|\d+\.\s)/.test(line) || !STRONG_DIRECTIVE.test(line)) continue;
      directives++;
      const next = file.lines[i + 1] ?? "";
      if (!RATIONALE.test(line) && !RATIONALE.test(next)) missing++;
    }
    if (directives >= MIN_DIRECTIVES && missing / directives >= MISSING_RATIO) {
      findings.push({
        rule: "missing-rationale",
        severity: "info",
        file: file.path,
        line: 0,
        message: `${missing} of ${directives} strong directives (never/always/must) carry no stated reason — rules whose rationale is lost are the ones nobody dares delete.`,
        hint: 'add a brief "because …" to each; rationale-attached rules stay prunable (arXiv 2608.11095).',
      });
    }
  }
  return findings;
}
