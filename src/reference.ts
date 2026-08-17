import * as fs from "node:fs";
import * as path from "node:path";
import { buildIndex, walk } from "./fswalk.js";
import { buildCommandIndex } from "./checks/deadCommands.js";

export interface ReferenceCheck {
  ok: boolean;
  kind: "path" | "script" | "make-target";
  suggestions: string[];
}

/**
 * Verify a single reference BEFORE it gets written into a context file —
 * the MCP `drift_check` tool: an agent about to update CLAUDE.md can
 * validate its own edit first.
 */
export function checkReference(root: string, reference: string): ReferenceCheck {
  const entries = walk(root);
  const ref = reference.trim().replace(/^`|`$/g, "");

  // path-shaped: contains a slash or a file extension
  if (ref.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(ref)) {
    const rel = ref.replace(/\/$/, "");
    if (fs.existsSync(path.join(root, rel))) return { ok: true, kind: "path", suggestions: [] };
    const index = buildIndex(root, entries);
    const base = rel.split("/").pop() ?? rel;
    return { ok: false, kind: "path", suggestions: (index.basenames.get(base) ?? []).slice(0, 5) };
  }

  // otherwise treat as npm script / make target
  const idx = buildCommandIndex(root, entries);
  if (idx.scripts.has(ref)) return { ok: true, kind: "script", suggestions: [] };
  if (idx.makeTargets.has(ref)) return { ok: true, kind: "make-target", suggestions: [] };
  const close = [...idx.scripts.keys(), ...idx.makeTargets.keys()]
    .filter((s) => s.includes(ref) || ref.includes(s))
    .slice(0, 5);
  return { ok: false, kind: "script", suggestions: close };
}
