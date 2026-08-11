import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextFile, Finding, PathRef, RepoIndex } from "../types.js";

const BUILD_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage", "target", "bin", "obj",
  ".next", ".nuxt", "vendor", "venv", ".venv", "__pycache__",
]);

const COMMON_TOOL_FILES = new Set([
  // names that appear in prose without being claims about THIS repo
  "settings.json", "settings.local.json", "mcp.json", ".mcp.json", "package.json",
  "tsconfig.json", "CLAUDE.md", "AGENTS.md", "SKILL.md", "README.md", "MEMORY.md",
  ".env", ".gitignore", "Makefile", "Dockerfile",
]);

/** A path the context file claims exists, but the tree says otherwise. */
export function checkDeadPaths(
  file: ContextFile,
  refs: PathRef[],
  index: RepoIndex,
): Finding[] {
  const findings: Finding[] = [];
  const fileDir = path.dirname(file.path);

  for (const ref of refs) {
    const rel = ref.raw.replace(/\/$/, "");
    const base = rel.split("/").pop() ?? rel;

    // bare filenames: only meaningful if they exist nowhere in the tree at all
    if (!ref.raw.includes("/")) {
      if (COMMON_TOOL_FILES.has(ref.raw)) continue;
      if (index.basenames.has(ref.raw)) continue;
      if (existsAt(index.root, fileDir, ref.raw)) continue;
      findings.push({
        rule: "dead-path",
        severity: "error",
        file: file.path,
        line: ref.line,
        message: `\`${ref.raw}\` is referenced but no file with that name exists anywhere in the repo.`,
      });
      continue;
    }

    if (existsAt(index.root, fileDir, rel)) continue;
    // dotfile roots like .claude/... may legitimately describe user-global files
    if (rel.startsWith("~") || rel.startsWith("/")) continue;
    // build artifacts exist or not depending on build state — never a drift signal
    const top = rel.replace(/^\.\//, "").split("/")[0] ?? "";
    if (BUILD_DIRS.has(top)) continue;

    const elsewhere = (index.basenames.get(base) ?? []).filter((p) => p !== rel);
    const hint = elsewhere.length
      ? `did you mean \`${elsewhere.slice(0, 3).join("\`, \`")}\`?`
      : undefined;
    findings.push({
      rule: "dead-path",
      severity: "error",
      file: file.path,
      line: ref.line,
      message: `\`${ref.raw}\` does not exist.`,
      ...(hint ? { hint } : {}),
    });
  }
  return findings;
}

function existsAt(root: string, fileDir: string, rel: string): boolean {
  return (
    fs.existsSync(path.join(root, rel)) ||
    fs.existsSync(path.join(root, fileDir, rel))
  );
}
