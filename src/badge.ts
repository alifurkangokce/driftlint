/** Below this many checked references the percentage is noise, not a signal. */
export const MIN_SCORED_REFS = 5;

/** shields.io endpoint-badge JSON — https://shields.io/badges/endpoint-badge
 *  Deterministic by design: a badge that flaps erodes trust — which is also
 *  why a repo with only a couple of references reports "n/a" instead of a
 *  percentage that one moved file could swing from 100 to 0. */
export function badgeJson(score: number, refsChecked?: number): object {
  if (refsChecked !== undefined && refsChecked < MIN_SCORED_REFS) {
    return { schemaVersion: 1, label: "context freshness", message: "n/a", color: "lightgrey" };
  }
  const color =
    score >= 90 ? "brightgreen" : score >= 75 ? "yellowgreen" : score >= 60 ? "yellow" : score >= 40 ? "orange" : "red";
  return { schemaVersion: 1, label: "context freshness", message: `${score}%`, color };
}
