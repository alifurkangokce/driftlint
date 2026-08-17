import * as fs from "node:fs";
import * as path from "node:path";
import type { Finding, ScanResult } from "./types.js";

const SEVERITY: Record<Finding["severity"], string> = {
  error: "ERROR",
  warning: "WARNING",
  info: "INFO",
};

/**
 * reviewdog RDFormat (rdjsonl): one Diagnostic JSON per line.
 * Findings with a mechanical fix carry a `suggestions` entry, which reviewdog
 * renders as a one-click "Apply suggestion" on GitHub PR reviews:
 *   driftlint --rdjsonl | reviewdog -f=rdjsonl -reporter=github-pr-review -filter-mode=nofilter
 * (nofilter matters: drift findings live on lines the diff never touched.)
 */
export function toRdjsonl(result: ScanResult): string {
  const lines: string[] = [];
  const fileCache = new Map<string, string[]>();
  const readLines = (rel: string): string[] => {
    let cached = fileCache.get(rel);
    if (!cached) {
      try {
        cached = fs.readFileSync(path.join(result.root, rel), "utf8").split(/\r?\n/);
      } catch {
        cached = [];
      }
      fileCache.set(rel, cached);
    }
    return cached;
  };

  for (const f of result.findings) {
    const line = Math.max(f.line, 1);
    const diagnostic: Record<string, unknown> = {
      message: f.hint ? `${f.message} (${f.hint})` : f.message,
      location: { path: f.file, range: { start: { line } } },
      severity: SEVERITY[f.severity],
      code: { value: f.rule, url: "https://github.com/alifurkangokce/driftlint#what-it-checks" },
      source: { name: "driftlint", url: "https://github.com/alifurkangokce/driftlint" },
    };
    if (f.fix && f.line > 0) {
      const text = readLines(f.file)[f.line - 1];
      const col = text?.indexOf(f.fix.oldText) ?? -1;
      if (col !== -1) {
        diagnostic["suggestions"] = [
          {
            range: {
              start: { line, column: col + 1 },
              end: { line, column: col + 1 + f.fix.oldText.length },
            },
            text: f.fix.newText,
          },
        ];
      }
    }
    lines.push(JSON.stringify(diagnostic));
  }
  return lines.join("\n");
}
