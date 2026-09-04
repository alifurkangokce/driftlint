import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextFile, Finding, PathRef, RepoIndex } from "../types.js";
import { KNOWN_META_FILES } from "./metaFiles.js";

const BUILD_DIRS = new Set([
  "node_modules", "dist", "build", "builddir", "out", "coverage", "target",
  "bin", "obj", ".next", ".nuxt", "vendor", "venv", ".venv", "__pycache__",
  "generated", ".cache", ".devenv", ".turbo", ".output", "tmp", "temp", "logs",
]);

/** Segments that mark a path as a template, not a claim about this repo. */
const PLACEHOLDER_SEGMENTS = new Set([
  "foo", "bar", "baz", "qux", "thing", "category", "placeholder",
  "myapp", "my-app", "mypackage", "my-package", "your-app", "yourapp", "xyz",
]);

const COMMON_TOOL_FILES = new Set([
  // names that appear in prose without being claims about THIS repo
  "settings.json", "settings.local.json", "mcp.json", ".mcp.json", "package.json",
  "tsconfig.json", "CLAUDE.md", "AGENTS.md", "SKILL.md", "README.md", "MEMORY.md",
  ".env", ".gitignore", "Makefile", "Dockerfile",
]);

export interface DeadPathResult {
  findings: Finding[];
  /** How many references were actually evaluated (resolved + flagged). */
  attempted: number;
}

/** A path the context file claims exists, but the tree says otherwise. */
export function checkDeadPaths(
  file: ContextFile,
  refs: PathRef[],
  index: RepoIndex,
): DeadPathResult {
  const findings: Finding[] = [];
  let resolved = 0;
  const fileDir = path.dirname(file.path);

  for (const ref of refs) {
    const rel = ref.raw.replace(/\/$/, "");
    const base = rel.split("/").pop() ?? rel;

    // bare filenames: only meaningful if they exist nowhere in the tree at all
    if (!ref.raw.includes("/")) {
      if (COMMON_TOOL_FILES.has(ref.raw)) continue;
      if (index.basenames.has(ref.raw) || existsAt(index.root, fileDir, ref.raw)) {
        resolved++;
        continue;
      }
      findings.push({
        rule: "dead-path",
        severity: "error",
        file: file.path,
        line: ref.line,
        message: `\`${ref.raw}\` is referenced but no file with that name exists anywhere in the repo.`,
      });
      continue;
    }

    if (existsAt(index.root, fileDir, rel)) {
      resolved++;
      continue;
    }
    // dotfile roots like .claude/... may legitimately describe user-global files
    if (rel.startsWith("~") || rel.startsWith("/")) continue;
    const segments = rel.replace(/^\.\//, "").split("/");
    // build artifacts exist or not depending on build state; placeholder
    // segments mark templates ("internal/impl/foo/input.go") — neither is drift
    if (segments.some((s) => BUILD_DIRS.has(s) || PLACEHOLDER_SEGMENTS.has(s.toLowerCase()))) continue;
    if (/(^|\/)path\/to(\/|$)/.test(rel)) continue;
    // date placeholders (`YYYYMM/`) and ALL-CAPS template segments
    // (`TEMPLATE/x.md`) are patterns, not paths — except the ALL-CAPS names
    // that are real files, where a broken reference is a real finding.
    if (
      segments.some(
        (s) =>
          s.startsWith("YYYY") ||
          (!s.includes(".") && /^[A-Z][A-Z0-9_-]+$/.test(s) && !KNOWN_META_FILES.has(s)),
      )
    ) continue;
    // lines describing runtime artifacts aren't claims that the path exists NOW
    const srcLine = file.lines[ref.line - 1] ?? "";
    if (/creat(e|ed|es|ing)|written to|will be|if (it )?(does ?n[o']t|doesn't) exist|\bgenerated\b|gitignored|\(optional\)|(cop(y|ies|ied|ying)|mov(e|es|ed|ing)|archiv(e|es|ed|ing)|renam(e|es|ed|ing))[^.]{0,60}\bto\b/i.test(srcLine)) continue;

    const elsewhere = (index.basenames.get(base) ?? []).filter((p) => p !== rel);
    const hint = elsewhere.length
      ? `did you mean \`${elsewhere.slice(0, 3).join("\`, \`")}\`?`
      : undefined;
    const single = elsewhere.length === 1 ? elsewhere[0] : undefined;
    const fix = single
      ? { oldText: ref.raw, newText: ref.raw.endsWith("/") ? `${single}/` : single }
      : undefined;
    // a single bare dir like `gateway/` is weak evidence — could describe a
    // deploy layout or a subdir of something named in prose. Downgrade it.
    const weak = segments.length === 1 && ref.raw.endsWith("/");
    findings.push({
      rule: "dead-path",
      severity: weak ? "warning" : "error",
      file: file.path,
      line: ref.line,
      message: `\`${ref.raw}\` does not exist.`,
      ...(hint ? { hint } : {}),
      ...(fix ? { fix } : {}),
    });
  }
  return { findings, attempted: resolved + findings.length };
}

function existsAt(root: string, fileDir: string, rel: string): boolean {
  return (
    fs.existsSync(path.join(root, rel)) ||
    fs.existsSync(path.join(root, fileDir, rel))
  );
}
