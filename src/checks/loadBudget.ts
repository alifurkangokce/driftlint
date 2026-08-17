import type { ContextFile, Finding } from "../types.js";

/**
 * "Will this file actually reach the model?" — a failure class users
 * misdiagnose for weeks: content past a harness limit silently never loads.
 */

/** Codex CLI silently truncates AGENTS.md at 32 KB — no warning, no error. */
const AGENTS_MD_LIMIT = 32_768;
const AGENTS_MD_APPROACH = Math.floor(AGENTS_MD_LIMIT * 0.85);

/** Instruction-following research: models reliably follow ~150 instructions;
 *  adherence degrades well before most 200+ line files end. */
const INSTRUCTION_SOFT_LIMIT = 150;

const MAIN_KINDS = new Set(["claude-md", "agents-md", "gemini"]);

export function checkLoadBudget(files: ContextFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!MAIN_KINDS.has(file.kind)) continue;

    if (file.kind === "agents-md") {
      const bytes = Buffer.byteLength(file.content, "utf8");
      if (bytes > AGENTS_MD_LIMIT) {
        findings.push({
          rule: "load-budget",
          severity: "warning",
          file: file.path,
          line: 0,
          message: `AGENTS.md is ${(bytes / 1024).toFixed(1)} KB — Codex CLI silently truncates at 32 KB, so the last ${((bytes - AGENTS_MD_LIMIT) / 1024).toFixed(1)} KB never reach the model.`,
          hint: "move detail into skills or linked docs; keep the entry file under the limit.",
        });
      } else if (bytes > AGENTS_MD_APPROACH) {
        findings.push({
          rule: "load-budget",
          severity: "info",
          file: file.path,
          line: 0,
          message: `AGENTS.md is ${(bytes / 1024).toFixed(1)} KB — approaching Codex CLI's 32 KB silent-truncation limit.`,
        });
      }
    }

    const instructionish = file.lines.filter((l) => /^\s*([-*+]\s|\d+\.\s)/.test(l)).length;
    if (instructionish > INSTRUCTION_SOFT_LIMIT) {
      findings.push({
        rule: "load-budget",
        severity: "info",
        file: file.path,
        line: 0,
        message: `${instructionish} instruction-like lines — research suggests models reliably follow ~${INSTRUCTION_SOFT_LIMIT}; the rest dilute adherence.`,
        hint: "split detail into skills (progressive disclosure) so it loads only when relevant.",
      });
    }
  }
  return findings;
}
