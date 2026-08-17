/** shields.io endpoint-badge JSON — https://shields.io/badges/endpoint-badge
 *  Deterministic by design: a badge that flaps erodes trust. */
export function badgeJson(score: number): object {
  const color =
    score >= 90 ? "brightgreen" : score >= 75 ? "yellowgreen" : score >= 60 ? "yellow" : score >= 40 ? "orange" : "red";
  return { schemaVersion: 1, label: "context freshness", message: `${score}%`, color };
}
