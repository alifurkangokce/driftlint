import * as fs from "node:fs";
import * as path from "node:path";
import type { Finding } from "./types.js";
import { fixRange } from "./fixRange.js";

export interface FixOutcome {
  applied: Finding[];
  skipped: Finding[];
}

/**
 * Apply the mechanical fixes attached to findings, editing context files in place.
 * Interactive by default (one y/N question per fix); `yes` applies everything.
 * In a non-TTY without `yes`, nothing is touched.
 */
export async function applyFixes(
  root: string,
  findings: Finding[],
  opts: { yes: boolean },
): Promise<FixOutcome> {
  const fixable = findings.filter((f) => f.fix && f.line > 0);
  const applied: Finding[] = [];
  const skipped: Finding[] = [];

  let rl: import("node:readline/promises").Interface | null = null;
  if (!opts.yes) {
    if (!process.stdin.isTTY) return { applied, skipped: fixable };
    const readline = await import("node:readline/promises");
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  const accepted: Finding[] = [];
  for (const f of fixable) {
    const fix = f.fix;
    if (!fix) continue;
    let ok = opts.yes;
    if (rl) {
      const answer = await rl.question(
        `fix ${f.file}:${f.line}  \`${fix.oldText}\` → \`${fix.newText}\`? [y/N] `,
      );
      ok = answer.trim().toLowerCase().startsWith("y");
    }
    if (!ok) {
      skipped.push(f);
      continue;
    }
    accepted.push(f);
  }
  rl?.close();

  // Resolve every range before editing, then apply right-to-left. A longer
  // replacement must not shift another finding's original column.
  const byFile = new Map<string, Finding[]>();
  for (const f of accepted) {
    // findings normally come from our own scan, but applyFixes is exported: a
    // caller's finding must not be able to write outside the scanned root
    const p = path.resolve(root, f.file);
    if (p !== path.resolve(root) && !p.startsWith(path.resolve(root) + path.sep)) {
      skipped.push(f);
      continue;
    }
    const group = byFile.get(p) ?? [];
    group.push(f);
    byFile.set(p, group);
  }
  for (const [p, group] of byFile) {
    let content: string;
    try {
      content = fs.readFileSync(p, "utf8");
    } catch {
      skipped.push(...group);
      continue;
    }
    const lines = content.split("\n");
    const candidates: Array<{ finding: Finding; start: number; end: number }> = [];
    for (const f of group) {
      const range = f.fix && fixRange(lines[f.line - 1], f.fix);
      if (!range || candidates.some((e) => e.finding.line === f.line && e.start === range.start && e.end === range.end && e.finding.fix?.newText === f.fix?.newText)) {
        skipped.push(f);
        continue;
      }
      candidates.push({ finding: f, ...range });
    }
    // Conflicting edits are ambiguous: do not pick a winner by input order.
    const edits = candidates.filter((e) => {
      const conflict = candidates.some((other) => other !== e && other.finding.line === e.finding.line && e.start < other.end && e.end > other.start);
      if (conflict) skipped.push(e.finding);
      return !conflict;
    });
    edits.sort((a, b) => b.finding.line - a.finding.line || b.start - a.start);
    for (const { finding: f, start, end } of edits) {
      const i = f.line - 1;
      const line = lines[i]!;
      // Slicing also treats dollar signs in replacement paths literally.
      lines[i] = line.slice(0, start) + f.fix!.newText + line.slice(end);
    }
    if (edits.length) {
      fs.writeFileSync(p, lines.join("\n"));
      applied.push(...edits.map((e) => e.finding));
    }
  }

  return { applied, skipped };
}
