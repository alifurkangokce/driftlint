import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextFile, Finding, PathRef, RepoIndex } from "../types.js";
import { KNOWN_META_FILES } from "./metaFiles.js";

export const BUILD_DIRS: ReadonlySet<string> = new Set([
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
  /** Of those, how many resolved only against the file's own nested project.
   *  These say nothing about whether the file describes THIS repo — they are
   *  the nested package's own files — so the foreign-context ratio ignores
   *  them and judges on the references that are left. */
  nestedResolved: number;
}

/** A path the context file claims exists, but the tree says otherwise. */
export function checkDeadPaths(
  file: ContextFile,
  refs: PathRef[],
  index: RepoIndex,
): DeadPathResult {
  const findings: Finding[] = [];
  let resolved = 0;
  let nestedResolved = 0;
  const fileDir = path.dirname(file.path);
  const project = enclosingProjectRoot(fileDir);
  /** Did this reference resolve ONLY because the file sits in a nested project? */
  const viaNestedOnly = (rel: string): boolean =>
    project !== null &&
    !fs.existsSync(path.join(index.root, rel)) &&
    !fs.existsSync(path.join(index.root, fileDir, rel)) &&
    fs.existsSync(path.join(index.root, project, rel));

  for (const ref of refs) {
    const rel = ref.raw.replace(/\/$/, "");
    const base = rel.split("/").pop() ?? rel;

    // bare filenames: only meaningful if they exist nowhere in the tree at all
    if (!ref.raw.includes("/")) {
      if (COMMON_TOOL_FILES.has(ref.raw)) continue;
      if (index.basenames.has(ref.raw) || existsAt(index.root, fileDir, ref.raw)) {
        resolved++;
        if (!index.basenames.has(ref.raw) && viaNestedOnly(ref.raw)) nestedResolved++;
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
      if (viaNestedOnly(rel)) nestedResolved++;
      continue;
    }
    // Context files often spell paths from outside the repo for readability
    // ("Ajanlarim/hafiza/"), while the scan starts inside that directory. Only
    // accept the stripped form when it actually resolves.
    const withoutSelfPrefix = stripSelfPrefix(index.root, rel);
    if (withoutSelfPrefix && existsAt(index.root, fileDir, withoutSelfPrefix)) {
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
  // A file that resolved anything against its own nested project root IS a
  // nested project's document. What it still can't resolve is far more likely
  // to be that project's surroundings than drift in the repo being scanned —
  // so say so, and stop calling it an error (issue #27).
  if (nestedResolved > 0) {
    for (const f of findings) {
      if (f.severity !== "error") continue;
      f.severity = "warning";
      f.hint = `${f.hint ? `${f.hint} · ` : ""}this file belongs to the nested project \`${project}\`, and some of its references resolve there — an unresolved one may simply live outside what was scanned.`;
    }
  }
  return { findings, attempted: resolved + findings.length, nestedResolved };
}

/** `<repo-name>/x` written from one directory up, scanned from inside. */
function stripSelfPrefix(root: string, rel: string): string | null {
  const rootName = path.basename(path.resolve(root));
  const segments = rel.replace(/^\.\//, "").split("/");
  return segments.length > 1 && segments[0] === rootName ? segments.slice(1).join("/") : null;
}

/** The directories an agent keeps its own files in. A context file inside one
 *  of these belongs to the project that OWNS the directory, not to the scan
 *  root — `sub/.agents/skills/x/SKILL.md` describes `sub/`. */
const AGENT_CONFIG_SEGMENT = /(^|\/)\.(claude|claude-plugin|cursor|codex|gemini|agents|opencode|github|windsurf|clinerules)(\/|$)/;

/** Where a nested project's own paths resolve from: the parent of the agent
 *  config directory the file sits under. Null when the file isn't in one, in
 *  which case its own directory is already the right base. */
export function enclosingProjectRoot(fileDir: string): string | null {
  const m = AGENT_CONFIG_SEGMENT.exec(`/${fileDir}`);
  if (!m) return null;
  // exec ran against "/" + fileDir, so m.index is the offset of the separator
  // preceding the config segment — which is where the owning project ends.
  const owner = fileDir.slice(0, m.index).replace(/\/$/, "");
  return owner === fileDir ? null : owner;
}

function existsAt(root: string, fileDir: string, rel: string): boolean {
  if (fs.existsSync(path.join(root, rel))) return true;
  if (fs.existsSync(path.join(root, fileDir, rel))) return true;
  // A vendored or nested project writes paths from its own root. Resolve there
  // too — issue #27: 39 of one workspace's 44 findings were this one shape.
  const project = enclosingProjectRoot(fileDir);
  return project !== null && fs.existsSync(path.join(root, project, rel));
}
