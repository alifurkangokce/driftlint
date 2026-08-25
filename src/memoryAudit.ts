import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildIndex, walk } from "./fswalk.js";
import { extractRefs } from "./extract.js";
import { checkDeadPaths } from "./checks/deadPaths.js";
import { buildCommandIndex, checkDeadCommands } from "./checks/deadCommands.js";
import type { ContextFile, Finding, ScanResult } from "./types.js";

/**
 * Claude Code auto-memory: each project gets ~/.claude/projects/<munged>/memory/
 * with a MEMORY.md index (only the first ~200 lines / 25KB load into sessions)
 * plus topic files read on demand. Memories decay exactly like context files —
 * they reference paths that got renamed, commands that got removed, and
 * [[other-memories]] that were deleted — but they live OUTSIDE the repo, so no
 * repo-scoped linter ever sees them. `driftlint memory audit` does.
 */

const FOLD_LINES = 200;
const FOLD_BYTES = 25 * 1024;
const FOREIGN_MIN_ATTEMPTED = 5;
const FOREIGN_RATIO = 0.6;

/** Locate the Claude Code auto-memory directory for a repo, if any. */
export function findMemoryDir(repoRoot: string): string | null {
  const configDir = process.env["CLAUDE_CONFIG_DIR"] ?? path.join(os.homedir(), ".claude");
  const abs = path.resolve(repoRoot);
  // Claude Code munges the absolute project path into a directory name
  const candidates = [...new Set([abs.replace(/\//g, "-"), abs.replace(/[/.]/g, "-")])];
  for (const c of candidates) {
    const p = path.join(configDir, "projects", c, "memory");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readMemoryFiles(memoryDir: string): ContextFile[] {
  const files: ContextFile[] = [];
  const names = fs
    .readdirSync(memoryDir, { recursive: true, encoding: "utf8" })
    .map((r) => r.split(path.sep).join("/"))
    .filter((r) => r.endsWith(".md"))
    .sort();
  for (const rel of names) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(memoryDir, rel), "utf8");
    } catch {
      continue;
    }
    files.push({ path: rel, kind: "memory", content, lines: content.split(/\r?\n/) });
  }
  return files;
}

/** Verify a memory directory against the repo it describes. */
export function auditMemory(repoRoot: string, memoryDir: string): ScanResult {
  const entries = walk(repoRoot);
  const index = buildIndex(repoRoot, entries);
  const cmdIndex = buildCommandIndex(repoRoot, entries);
  const files = readMemoryFiles(memoryDir);

  const findings: Finding[] = [];
  // [[links]] may target the file basename OR the frontmatter `name:` slug,
  // and slug conventions differ (kebab vs snake) — normalize both sides
  const norm = (s: string) => s.toLowerCase().replace(/[_-]+/g, "-");
  const memoryNames = new Set<string>();
  for (const f of files) {
    memoryNames.add(norm(path.posix.basename(f.path, ".md")));
    const fmName = /^---[\s\S]*?^name:\s*(\S+)\s*$/m.exec(f.content.slice(0, 500))?.[1];
    if (fmName) memoryNames.add(norm(fmName));
  }
  let refsChecked = 0;
  let refsBroken = 0;

  for (const file of files) {
    const { paths, commands } = extractRefs(file);
    const dead = checkDeadPaths(file, paths, index);

    // Memories legitimately record facts about OTHER repos the project touches —
    // when most of a memory's references don't resolve here, that's provenance,
    // not drift. Same collapse thresholds as the scanner's foreign-context rule.
    if (dead.attempted >= FOREIGN_MIN_ATTEMPTED && dead.findings.length / dead.attempted >= FOREIGN_RATIO) {
      findings.push({
        rule: "foreign-context",
        severity: "info",
        file: file.path,
        line: 0,
        message: `${dead.findings.length} of ${dead.attempted} references don't resolve in this repo — this memory probably records facts about another repo; path/command checks skipped.`,
      });
      continue;
    }

    // a bare filename in a memory often describes ANOTHER repo the project
    // touches — weaker evidence than a slashed repo path, so never an error
    findings.push(
      ...dead.findings.map((f) =>
        f.message.includes("anywhere in the repo") ? { ...f, severity: "warning" as const } : f,
      ),
    );
    findings.push(...checkDeadCommands(repoRoot, file, commands, cmdIndex));
    refsChecked += dead.attempted;
    refsBroken += dead.findings.filter(
      (f) => f.severity === "error" && !f.message.includes("anywhere in the repo"),
    ).length;

    // [[wiki-links]] between memories: a link to a deleted memory dangles forever
    for (let i = 0; i < file.lines.length; i++) {
      for (const m of (file.lines[i] ?? "").matchAll(/\[\[([^[\]|#]+)\]\]/g)) {
        const name = m[1]?.trim();
        if (!name || memoryNames.has(norm(name))) continue;
        findings.push({
          rule: "dead-path",
          severity: "warning",
          file: file.path,
          line: i + 1,
          message: `\`[[${name}]]\` links to a memory file that doesn't exist (\`${name}.md\`).`,
          hint: "the linked memory was deleted or renamed — update or drop the link.",
        });
      }
    }
  }

  // Only the top of MEMORY.md loads into sessions — everything below the fold
  // is invisible exactly like an overflowing skill description.
  const idx = files.find((f) => f.path === "MEMORY.md");
  if (idx) {
    const bytes = Buffer.byteLength(idx.content);
    if (idx.lines.length > FOLD_LINES || bytes > FOLD_BYTES) {
      const over =
        idx.lines.length > FOLD_LINES
          ? `${idx.lines.length - FOLD_LINES} lines past the ${FOLD_LINES}-line fold`
          : `${bytes - FOLD_BYTES} bytes past the ${Math.round(FOLD_BYTES / 1024)}KB fold`;
      findings.push({
        rule: "load-budget",
        severity: "warning",
        file: "MEMORY.md",
        line: FOLD_LINES + 1,
        message: `MEMORY.md is ${over} — only the first ${FOLD_LINES} lines / ${Math.round(FOLD_BYTES / 1024)}KB load into sessions; the rest silently never reaches the model.`,
        hint: "move detail into topic files (loaded on demand) and keep MEMORY.md a one-line-per-memory index.",
      });
    }
  }

  return {
    root: memoryDir,
    contextFiles: files.map((f) => f.path),
    findings,
    stats: {
      refsChecked,
      refsBroken,
      score: refsChecked === 0 ? 100 : Math.round((100 * (refsChecked - refsBroken)) / refsChecked),
    },
  };
}
