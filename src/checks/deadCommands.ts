import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandRef, ContextFile, Finding } from "../types.js";

/** A command the context file tells the agent to run, but that no longer exists. */
export function checkDeadCommands(
  root: string,
  file: ContextFile,
  refs: CommandRef[],
): Finding[] {
  const findings: Finding[] = [];
  const fileDir = path.dirname(file.path);

  const scripts = readScripts(root, fileDir);
  const makeTargets = readMakeTargets(root, fileDir);

  for (const ref of refs) {
    if (ref.kind === "npm-script") {
      if (scripts === null) continue; // no package.json in scope — nothing to verify against
      if (scripts.has(ref.name)) continue;
      const close = [...scripts].filter((s) => s.includes(ref.name) || ref.name.includes(s)).slice(0, 3);
      findings.push({
        rule: "dead-command",
        severity: "error",
        file: file.path,
        line: ref.line,
        message: `script \`${ref.name}\` is not in package.json scripts.`,
        ...(close.length ? { hint: `closest: \`${close.join("`, `")}\`` } : {}),
      });
    } else {
      if (makeTargets === null) continue;
      if (makeTargets.has(ref.name)) continue;
      findings.push({
        rule: "dead-command",
        severity: "error",
        file: file.path,
        line: ref.line,
        message: `make target \`${ref.name}\` is not in the Makefile.`,
      });
    }
  }
  return findings;
}

function readScripts(root: string, fileDir: string): Set<string> | null {
  for (const dir of [fileDir, "."]) {
    const p = path.join(root, dir, "package.json");
    if (!fs.existsSync(p)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(p, "utf8")) as { scripts?: Record<string, string> };
      return new Set(Object.keys(pkg.scripts ?? {}));
    } catch {
      return null;
    }
  }
  return null;
}

function readMakeTargets(root: string, fileDir: string): Set<string> | null {
  for (const dir of [fileDir, "."]) {
    const p = path.join(root, dir, "Makefile");
    if (!fs.existsSync(p)) continue;
    const targets = new Set<string>();
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^([A-Za-z0-9_.-]+):(?!=)/.exec(line);
      if (m?.[1]) targets.add(m[1]);
    }
    return targets;
  }
  return null;
}
