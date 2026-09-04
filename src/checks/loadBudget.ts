import type { ContextFile, Finding } from "../types.js";

/**
 * "Will this file actually reach the model?" — a failure class users
 * misdiagnose for weeks: content past a harness limit silently never loads.
 */

/** Codex CLI silently truncates instruction files at 32 KB — and the budget is
 *  shared: it concatenates the AGENTS.md files that apply to the working
 *  directory (and a global one this scan can't see), so several files that each
 *  pass on their own can still be cut off together. No warning, no error. */
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

    const instructionish = countInstructionLines(file.lines);
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
  findings.push(...checkConcatenatedBudget(files));
  return findings;
}

/** The per-file check misses the common case: a root AGENTS.md plus nested ones
 *  that are each comfortably under the limit and blow it once concatenated. */
function checkConcatenatedBudget(files: ContextFile[]): Finding[] {
  const agents = files.filter((f) => f.kind === "agents-md");
  if (agents.length < 2) return []; // the single-file case is already covered

  const sizes = agents
    .map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content, "utf8") }))
    .sort((a, b) => b.bytes - a.bytes);
  const total = sizes.reduce((a, f) => a + f.bytes, 0);
  if (total <= AGENTS_MD_LIMIT) return [];
  // an individually-oversized file already has its own finding
  if (sizes[0] && sizes[0].bytes > AGENTS_MD_LIMIT) return [];

  const root = agents.find((f) => !f.path.includes("/"))?.path;
  const biggest = sizes.slice(0, 3).map((f) => `${f.path} (${(f.bytes / 1024).toFixed(1)} KB)`);
  return [
    {
      rule: "load-budget",
      severity: "warning",
      file: root ?? sizes[0]?.path ?? "AGENTS.md",
      line: 0,
      message: `${agents.length} AGENTS.md files total ${(total / 1024).toFixed(1)} KB — Codex concatenates the ones that apply and truncates the result at 32 KB, so ${((total - AGENTS_MD_LIMIT) / 1024).toFixed(1)} KB of it never reaches the model even though every file passes on its own.`,
      hint: `largest: ${biggest.join(", ")}. Only the files on the path to the working directory are concatenated, so a deep file may be safe — and a global ~/.codex/AGENTS.md counts too but is outside this repo.`,
    },
  ];
}

/** Bullets inside a fence are an example being shown to the model (a YAML
 *  snippet, a sample config), not instructions it is asked to follow. */
function countInstructionLines(lines: string[]): number {
  let count = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^\s*([-*+]\s|\d+\.\s)/.test(line)) count++;
  }
  return count;
}
