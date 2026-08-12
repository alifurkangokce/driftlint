import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextFile } from "./types.js";
import type { WalkEntry } from "./fswalk.js";

function kindOf(rel: string): ContextFile["kind"] | null {
  const base = rel.split("/").pop() ?? "";
  if (base === "CLAUDE.md" || base === "CLAUDE.local.md") return "claude-md";
  if (base === "AGENTS.md") return "agents-md";
  if (rel === ".github/copilot-instructions.md") return "copilot";
  if (/(^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/.test(rel)) return "skill";
  if (/(^|\/)\.claude\/agents\/[^/]+\.md$/.test(rel)) return "subagent";
  if (/(^|\/)\.claude\/commands\/[^/]+\.md$/.test(rel)) return "command";
  if (/(^|\/)\.cursor\/rules\/[^/]+\.(md|mdc)$/.test(rel)) return "cursor-rule";
  if (base === "GEMINI.md") return "gemini";
  if (base === ".windsurfrules") return "windsurf";
  if (base === ".clinerules") return "cline";
  if (/(^|\/)\.clinerules\/[^/]+\.md$/.test(rel)) return "cline";
  if (/(^|\/)\.opencode\/(agent|command|knowledge)\/.+\.md$/.test(rel)) return "opencode";
  return null;
}

/** Pick the agent context files out of a walked tree and load their contents. */
export function discoverContextFiles(root: string, entries: WalkEntry[]): ContextFile[] {
  const files: ContextFile[] = [];
  for (const e of entries) {
    if (e.isDir) continue;
    const kind = kindOf(e.rel);
    if (!kind) continue;
    let content: string;
    try {
      content = fs.readFileSync(path.join(root, e.rel), "utf8");
    } catch {
      continue;
    }
    files.push({ path: e.rel, kind, content, lines: content.split(/\r?\n/) });
  }
  return files;
}
