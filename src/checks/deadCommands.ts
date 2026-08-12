import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandRef, ContextFile, Finding } from "../types.js";
import type { WalkEntry } from "../fswalk.js";

const MAX_MANIFESTS = 300;

export interface CommandIndex {
  /** script name -> package.json rel paths that define it */
  scripts: Map<string, string[]>;
  /** make target -> Makefile rel paths that define it */
  makeTargets: Map<string, string[]>;
  hasPackageJson: boolean;
  hasMakefile: boolean;
}

/** Parse every package.json / Makefile in the tree once, so monorepo workspace
 *  scripts are recognized instead of flagged. */
export function buildCommandIndex(root: string, entries: WalkEntry[]): CommandIndex {
  const idx: CommandIndex = {
    scripts: new Map(),
    makeTargets: new Map(),
    hasPackageJson: false,
    hasMakefile: false,
  };
  let parsed = 0;
  for (const e of entries) {
    if (e.isDir || parsed > MAX_MANIFESTS) continue;
    const base = e.rel.split("/").pop();
    if (base === "package.json") {
      idx.hasPackageJson = true;
      parsed++;
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, e.rel), "utf8")) as {
          scripts?: Record<string, string>;
        };
        for (const name of Object.keys(pkg.scripts ?? {})) {
          const list = idx.scripts.get(name) ?? [];
          list.push(e.rel);
          idx.scripts.set(name, list);
        }
      } catch {
        /* unparseable manifest — nothing to index */
      }
    } else if (base === "Makefile") {
      idx.hasMakefile = true;
      parsed++;
      for (const line of fs.readFileSync(path.join(root, e.rel), "utf8").split(/\r?\n/)) {
        const m = /^([A-Za-z0-9_.-]+):(?!=)/.exec(line);
        if (m?.[1]) {
          const list = idx.makeTargets.get(m[1]) ?? [];
          list.push(e.rel);
          idx.makeTargets.set(m[1], list);
        }
      }
    }
  }
  return idx;
}

/** A command the context file tells the agent to run, but that no longer exists. */
export function checkDeadCommands(
  root: string,
  file: ContextFile,
  refs: CommandRef[],
  idx: CommandIndex,
): Finding[] {
  const findings: Finding[] = [];
  const fileDir = path.dirname(file.path);
  const scopeManifests = (name: string) =>
    fileDir === "." ? [name] : [`${fileDir}/${name}`, name];

  for (const ref of refs) {
    const map = ref.kind === "npm-script" ? idx.scripts : idx.makeTargets;
    const hasAny = ref.kind === "npm-script" ? idx.hasPackageJson : idx.hasMakefile;
    if (!hasAny) continue; // nothing to verify against

    const definedIn = map.get(ref.name) ?? [];
    const scope = scopeManifests(ref.kind === "npm-script" ? "package.json" : "Makefile");
    if (definedIn.some((p) => scope.includes(p))) continue; // defined where the file points

    const label = ref.kind === "npm-script" ? "script" : "make target";
    const where = ref.kind === "npm-script" ? "package.json scripts" : "the Makefile";
    if (definedIn.length > 0) {
      // exists, but in another workspace package — a location problem, not a dead command
      findings.push({
        rule: "dead-command",
        severity: "warning",
        file: file.path,
        line: ref.line,
        message: `${label} \`${ref.name}\` is not in ${where} at this scope.`,
        hint: `defined in \`${definedIn[0]}\` — the instruction may need a working-directory note.`,
      });
      continue;
    }
    const close = [...map.keys()]
      .filter((s) => s.includes(ref.name) || ref.name.includes(s))
      .slice(0, 3);
    findings.push({
      rule: "dead-command",
      severity: "error",
      file: file.path,
      line: ref.line,
      message: `${label} \`${ref.name}\` is not in ${where}.`,
      ...(close.length ? { hint: `closest: \`${close.join("`, `")}\`` } : {}),
    });
  }
  return findings;
}
