/**
 * ALL-CAPS names that are real files in a repo, not fill-in placeholders.
 * The placeholder heuristics (`TEMPLATE/`, `TFS_LINK`, `YYYYMM/`) would
 * otherwise swallow them, and a broken link to LICENSE is a real finding.
 */
export const KNOWN_META_FILES = new Set([
  "LICENSE", "LICENCE", "COPYING", "NOTICE", "PATENTS",
  "README", "CHANGELOG", "CHANGES", "HISTORY", "TODO", "ROADMAP",
  "CONTRIBUTING", "CODEOWNERS", "MAINTAINERS", "AUTHORS", "CONTRIBUTORS",
  "SECURITY", "SUPPORT", "GOVERNANCE", "VERSION", "MANIFEST", "AGENTS", "CLAUDE",
]);
