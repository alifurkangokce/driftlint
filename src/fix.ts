import * as fs from "node:fs";
import * as path from "node:path";
import type { Finding } from "./types.js";

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
    const p = path.join(root, f.file);
    let content: string;
    try {
      content = fs.readFileSync(p, "utf8");
    } catch {
      skipped.push(f);
      continue;
    }
    const lines = content.split("\n");
    const i = f.line - 1;
    const line = lines[i];
    if (line !== undefined && line.includes(fix.oldText)) {
      // the callback form takes the replacement literally: with a string
      // replacement, `$$`, `$&`, "$`" and `$'` in a path would splice
      // surrounding text into the file instead of writing what we found
      lines[i] = line.replace(fix.oldText, () => fix.newText);
      fs.writeFileSync(p, lines.join("\n"));
      applied.push(f);
    } else {
      skipped.push(f);
    }
  }

  rl?.close();
  return { applied, skipped };
}
