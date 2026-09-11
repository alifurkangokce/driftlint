import type { Finding } from "./types.js";

/** Resolve a fix against the original source; never guess between occurrences. */
export function fixRange(line: string | undefined, fix: NonNullable<Finding["fix"]>): { start: number; end: number } | null {
  if (line === undefined || !fix.oldText) return null;
  let start: number;
  if (fix.column !== undefined) {
    if (!Number.isInteger(fix.column) || fix.column < 1) return null;
    start = fix.column - 1;
  } else {
    start = line.indexOf(fix.oldText);
    if (start === -1 || line.indexOf(fix.oldText, start + 1) !== -1) return null;
  }
  const end = start + fix.oldText.length;
  return line.slice(start, end) === fix.oldText ? { start, end } : null;
}
