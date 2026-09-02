import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextFile, Finding, RepoIndex } from "../types.js";
import type { WalkEntry } from "../fswalk.js";

/**
 * Machine-readable agent config makes claims too. A hook points at a script, an
 * MCP server points at a local entry file, a plugin manifest points at its
 * commands — and when that path is wrong the tool fails quietly (or not at all,
 * until someone triggers it). Schema validators can't catch this: the JSON is
 * perfectly valid, the file just isn't there.
 */

/** Config files whose string values may carry repo-relative paths. */
const CONFIG_BASENAMES = new Set([
  "settings.json",
  "settings.local.json",
  ".mcp.json",
  "mcp.json",
  "plugin.json",
  "marketplace.json",
  "hooks.json",
]);

const MAX_CONFIG_FILES = 40;
const MAX_STRINGS_PER_FILE = 400;

/** Variables the harnesses expand for us; anything else stays unresolved. */
const PROJECT_VARS = ["CLAUDE_PROJECT_DIR", "CLAUDE_PLUGIN_ROOT", "CLAUDE_CONFIG_DIR"];

/** Script-ish extensions: a bare token with one of these is a path claim. */
const SCRIPT_EXTS = /\.(sh|bash|zsh|js|mjs|cjs|ts|mts|cts|py|rb|pl|php|ps1|jar|json|md|mdc|yaml|yml|toml)$/i;

/** Prefixes that mark a token as repo-relative even without an extension. */
const REPO_PREFIXES =
  /^(\.\/|\.claude\/|\.cursor\/|\.github\/|\.opencode\/|scripts\/|bin\/|tools\/|commands\/|agents\/|skills\/|hooks\/|src\/|mcp\/)/;

interface Candidate {
  raw: string;
  /** Path relative to the scanned root, after variable expansion. */
  rel: string;
}

export function checkConfigRefs(root: string, entries: WalkEntry[], index: RepoIndex): Finding[] {
  const findings: Finding[] = [];
  let seen = 0;

  for (const e of entries) {
    if (e.isDir) continue;
    const base = e.rel.split("/").pop() ?? "";
    if (!CONFIG_BASENAMES.has(base)) continue;
    // package.json-adjacent settings.json files are everywhere; only agent config
    if (base === "settings.json" || base === "settings.local.json" || base === "hooks.json") {
      if (!/(^|\/)(\.claude|\.cursor|\.vscode-agent|\.kiro)\//.test(e.rel)) continue;
    }
    if (base === "plugin.json" || base === "marketplace.json") {
      if (!/(^|\/)\.claude-plugin\//.test(e.rel)) continue;
    }
    if (++seen > MAX_CONFIG_FILES) break;

    let content: string;
    let parsed: unknown;
    try {
      content = fs.readFileSync(path.join(root, e.rel), "utf8");
      parsed = JSON.parse(content);
    } catch {
      continue; // unparseable JSON is a schema problem, not ours
    }

    const configDir = path.posix.dirname(e.rel);
    // plugin manifests resolve against the plugin root (the dir holding .claude-plugin)
    const pluginRoot = /(^|\/)\.claude-plugin$/.test(configDir)
      ? path.posix.dirname(configDir)
      : configDir;
    const lines = content.split(/\r?\n/);

    const strings: StringRef[] = [];
    collectStrings(parsed, "", strings);

    const reported = new Set<string>();
    for (const s of strings.slice(0, MAX_STRINGS_PER_FILE)) {
      // deny/ask rules are defensive: naming a path that doesn't exist is fine
      if (/^permissions\.(deny|ask)/.test(s.key)) continue;
      // an allow-rule for a deleted script is dead config, but weaker evidence
      // than a hook or server entry the tool will actually try to execute
      const severity = s.key.startsWith("permissions") ? ("warning" as const) : ("error" as const);
      for (const cand of candidatesFrom(s.value)) {
        if (reported.has(cand.rel)) continue;
        const bases = [root, path.join(root, pluginRoot), path.join(root, configDir)];
        if (bases.some((b) => fs.existsSync(path.join(b, cand.rel)))) continue;
        reported.add(cand.rel);

        const name = cand.rel.split("/").pop() ?? cand.rel;
        const elsewhere = (index.basenames.get(name) ?? []).filter((p) => p !== cand.rel);
        findings.push({
          rule: "dead-config-ref",
          severity,
          file: e.rel,
          line: lineOf(lines, cand.raw),
          message: `\`${cand.raw}\` is configured here but does not exist.`,
          ...(elsewhere.length
            ? { hint: `did you mean \`${elsewhere.slice(0, 3).join("`, `")}\`?` }
            : { hint: "the tool will fail silently the first time this entry is used." }),
        });
      }
    }
  }

  return findings;
}

/** `allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)` and body
 *  references to bundled scripts are claims about the skill's own directory. */
export function checkSkillScriptRefs(root: string, skills: ContextFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of skills) {
    const skillDir = path.posix.dirname(file.path);
    const reported = new Set<string>();
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? "";
      if (!line.includes("CLAUDE_SKILL_DIR") && !line.includes("CLAUDE_PLUGIN_ROOT")) continue;
      for (const m of line.matchAll(/\$\{?(CLAUDE_SKILL_DIR|CLAUDE_PLUGIN_ROOT)\}?\/([^\s"'`)*|;&]+)/g)) {
        const suffix = (m[2] ?? "").replace(/[.,;:]+$/, "");
        if (!suffix || reported.has(suffix)) continue;
        const rel =
          m[1] === "CLAUDE_SKILL_DIR"
            ? path.posix.join(skillDir, suffix)
            : suffix;
        if (fs.existsSync(path.join(root, rel))) continue;
        reported.add(suffix);
        findings.push({
          rule: "dead-config-ref",
          severity: "error",
          file: file.path,
          line: i + 1,
          message: `\`${m[0]}\` points at \`${rel}\`, which does not exist.`,
          hint: "a bundled script that isn't there turns the skill into a permission prompt and a failed command.",
        });
      }
    }
  }
  return findings;
}

interface StringRef {
  value: string;
  /** Dotted key path, so a permission rule can be told from a hook command. */
  key: string;
}

function collectStrings(node: unknown, key: string, out: StringRef[]): void {
  if (typeof node === "string") {
    out.push({ value: node, key });
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectStrings(v, key, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) collectStrings(v, key ? `${key}.${k}` : k, out);
  }
}

/** Pull repo-relative path claims out of one config string (which may be a
 *  whole shell command). Conservative by design: unknown variables, globs,
 *  absolute and remote targets are all skipped. */
function candidatesFrom(value: string): Candidate[] {
  if (!value || value.length > 500) return [];
  const out: Candidate[] = [];
  for (const rawToken of value.split(/[\s"'`|&;()<>]+/)) {
    let t = rawToken.trim().replace(/[.,;:]+$/, "");
    if (!t || t.length > 200) continue;
    if (!t.includes("/")) continue;
    if (/^(https?|file|git|ssh|npm|npx|uvx|docker):/i.test(t)) continue;
    if (t.startsWith("~") || t.startsWith("-")) continue;
    if (/[*?\[\]]/.test(t)) continue;

    const raw = t;
    for (const v of PROJECT_VARS) {
      t = t.split(`\${${v}}`).join("").split(`$${v}`).join("");
    }
    // any variable we can't expand makes the path unknowable
    if (t.includes("$")) continue;
    t = t.replace(/^\/+/, "");
    if (!t) continue;
    // absolute paths that didn't come from a project variable describe a machine
    if (raw.startsWith("/") && raw === t) continue;
    if (raw.startsWith("/") && !PROJECT_VARS.some((v) => rawToken.includes(v))) continue;

    const normalized = path.posix.normalize(t);
    if (normalized.startsWith("..")) continue;
    if (!SCRIPT_EXTS.test(normalized) && !REPO_PREFIXES.test(normalized)) continue;
    // node_modules binaries and build output aren't claims about source
    if (/(^|\/)(node_modules|dist|build|out|target|\.venv|venv)(\/|$)/.test(normalized)) continue;

    out.push({ raw, rel: normalized.replace(/^\.\//, "") });
  }
  return out;
}

function lineOf(lines: string[], needle: string): number {
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? "").includes(needle)) return i + 1;
  }
  return 0;
}
