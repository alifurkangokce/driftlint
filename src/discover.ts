import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextFile } from "./types.js";
import type { WalkEntry } from "./fswalk.js";

/**
 * What each agent actually loads, as documented by the agents themselves.
 * Patterns are nested by default: a rule in `.claude/agents/backend/api.md`
 * is loaded exactly like one at the top of that directory, so a single-segment
 * pattern silently misses half of a well-organised repo.
 */
const SURFACES: Array<[RegExp, ContextFile["kind"]]> = [
  // root instruction files (nested AGENTS.md/CLAUDE.md are read by most agents)
  [/(^|\/)CLAUDE\.(local\.)?md$/, "claude-md"],
  [/(^|\/)AGENTS(\.override)?\.md$/, "agents-md"],
  [/(^|\/)GEMINI\.md$/, "gemini"],

  // Copilot
  [/(^|\/)\.github\/copilot-instructions\.md$/, "copilot"],
  [/(^|\/)\.github\/instructions\/.+\.instructions\.md$/, "copilot"],
  [/(^|\/)\.github\/agents\/.+\.agent\.md$/, "subagent"],

  // Agent Skills (agentskills.io): a cross-tool standard — Claude Code, Cursor,
  // Codex and Copilot all load <name>/SKILL.md, several from each other's dirs
  [/(^|\/)\.(claude|cursor|codex|gemini|github)\/skills\/.+\/SKILL\.md$/, "skill"],
  [/(^|\/)\.agents\/skills\/.+\/SKILL\.md$/, "skill"],

  // rule directories
  [/(^|\/)\.claude\/rules\/.+\.md$/, "rule"],
  [/(^|\/)\.codex\/rules\/.+\.rules$/, "rule"],
  // Cursor only reads .mdc here; a plain .md never loads (see checkSilentConfig)
  [/(^|\/)\.cursor\/rules\/.+\.mdc$/, "cursor-rule"],

  // sub-agents and commands
  [/(^|\/)\.(claude|cursor|gemini)\/agents\/.+\.md$/, "subagent"],
  [/(^|\/)\.claude\/commands\/.+\.md$/, "command"],

  // other CLIs
  [/(^|\/)\.windsurfrules$/, "windsurf"],
  [/(^|\/)\.clinerules$/, "cline"],
  [/(^|\/)\.clinerules\/.+\.md$/, "cline"],
  [/(^|\/)\.opencode\/(agent|command|knowledge)\/.+\.md$/, "opencode"],

  [/(^|\/)\.agent-memory\/(approved|proposals)\/[^/]+\.md$/, "memory"],
];

function kindOf(rel: string): ContextFile["kind"] | null {
  for (const [pattern, kind] of SURFACES) {
    if (pattern.test(rel)) return kind;
  }
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
