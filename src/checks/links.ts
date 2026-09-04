import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextFile, Finding, RepoIndex } from "../types.js";
import type { LinkRef } from "../extract.js";
import { KNOWN_META_FILES } from "./metaFiles.js";

/**
 * Markdown links inside context files are instructions too: "the deployment
 * steps live in [docs/deploy.md#staging]". When the target moves or the heading
 * is renamed, the agent follows a link to nothing — and unlike a human reader,
 * it never notices the 404.
 */

const BUILD_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage", "target", "bin", "obj",
  ".next", ".nuxt", "vendor", "venv", ".venv", "__pycache__", "generated", ".cache",
]);

const PLACEHOLDER_SEGMENTS = new Set([
  "foo", "bar", "baz", "qux", "myapp", "my-app", "your-app", "yourapp", "placeholder",
]);

/** `TFS_LINK`, `YOUR_DOC_URL`, `TEMPLATE` — ALL-CAPS names an author is
 *  expected to replace, minus the ones that are real files. */
const ALL_CAPS_TARGET = /^[A-Z][A-Z0-9_]*$/;

/** Line-number anchors (`#L42`, `#L10-L20`) are a code-host feature, not a heading. */
const LINE_ANCHOR = /^L\d+(?:-L?\d+)?$/;
const FUTURE_ARTIFACT_LINE = /creat(e|ed|es|ing)|will be|generated|\(optional\)|if (it )?(does ?n[o']t|doesn't) exist/i;

export function checkLinks(
  file: ContextFile,
  links: LinkRef[],
  index: RepoIndex,
): Finding[] {
  const findings: Finding[] = [];
  const fileDir = path.posix.dirname(file.path);
  const anchorCache = new Map<string, Set<string> | null>();

  for (const link of links) {
    // lines describing artifacts that get created later aren't claims about now
    const sourceLines = link.usageLines ?? [link.line];
    if (sourceLines.every((line) => FUTURE_ARTIFACT_LINE.test(file.lines[line - 1] ?? ""))) continue;

    // fill-in markers ("see the ticket at [details](TFS_LINK)") are placeholders
    // an author is expected to replace — but LICENSE, CHANGELOG and CODEOWNERS
    // are ALL CAPS too, and a broken link to one of those is a real finding.
    if (ALL_CAPS_TARGET.test(link.target) && !KNOWN_META_FILES.has(link.target)) continue;

    const rel = link.target ? path.posix.normalize(path.posix.join(fileDir === "." ? "" : fileDir, link.target)) : file.path;
    if (rel.startsWith("..")) continue; // escapes the scanned root — not ours to verify
    const segments = rel.split("/");
    if (segments.some((s) => BUILD_DIRS.has(s) || PLACEHOLDER_SEGMENTS.has(s.toLowerCase()))) continue;

    const abs = path.join(index.root, rel);
    if (!fs.existsSync(abs)) {
      const base = segments[segments.length - 1] ?? rel;
      const elsewhere = (index.basenames.get(base) ?? []).filter((p) => p !== rel);
      const single = elsewhere.length === 1 ? elsewhere[0] : undefined;
      findings.push({
        rule: "dead-link",
        severity: "error",
        file: file.path,
        line: link.line,
        message: `link target \`${link.target}\` does not exist.`,
        ...(elsewhere.length ? { hint: `did you mean \`${elsewhere.slice(0, 3).join("\`, \`")}\`?` } : {}),
        ...(single && !link.isReference
          ? { fix: { oldText: link.target, newText: relativeTo(fileDir, single) } }
          : {}),
      });
      continue;
    }

    if (!link.anchor || LINE_ANCHOR.test(link.anchor)) continue;
    if (!/\.mdx?$/i.test(rel)) continue; // only markdown has headings we can resolve
    if (!anchorCache.has(rel)) anchorCache.set(rel, readAnchors(abs));
    const anchors = anchorCache.get(rel);
    if (!anchors || anchors.size === 0) continue; // unreadable or heading-less: no claim to check

    const wanted = normalizeAnchor(link.anchor);
    if (anchors.has(wanted)) continue;
    const close = [...anchors].filter((a) => a.includes(wanted) || wanted.includes(a)).slice(0, 3);
    findings.push({
      rule: "dead-link",
      severity: "warning",
      file: file.path,
      line: link.line,
      message: `\`${link.target || rel}\` has no \`#${link.anchor}\` heading.`,
      ...(close.length ? { hint: `closest: \`#${close.join("\`, \`#")}\`` } : {}),
      ...(close.length === 1 && close[0] && !link.isReference
        ? { fix: { oldText: `#${link.anchor}`, newText: `#${close[0]}` } }
        : {}),
    });
  }
  return findings;
}

function relativeTo(fileDir: string, target: string): string {
  if (fileDir === ".") return target;
  const r = path.posix.relative(fileDir, target);
  return r.startsWith(".") ? r : `./${r}`;
}

/** GitHub-flavored heading slugs, plus explicit HTML anchors. */
function readAnchors(abs: string): Set<string> | null {
  let content: string;
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  let inFence = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h?.[1]) {
      const slug = slugify(h[1]);
      if (slug) {
        const n = counts.get(slug) ?? 0;
        counts.set(slug, n + 1);
        anchors.add(n === 0 ? slug : `${slug}-${n}`);
      }
    }
    for (const m of line.matchAll(/<a\s[^>]*?(?:name|id)\s*=\s*["']([^"']+)["']/gi)) {
      if (m[1]) anchors.add(normalizeAnchor(m[1]));
    }
    // markdownlint/kramdown style explicit ids: `## Heading {#custom-id}`
    for (const m of line.matchAll(/\{#([^}\s]+)\}/g)) {
      if (m[1]) anchors.add(normalizeAnchor(m[1]));
    }
  }
  return anchors;
}

function slugify(heading: string): string {
  return normalizeAnchor(
    heading
      // strip markdown emphasis, inline code, and link syntax but keep the text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[`*_~]/g, ""),
  );
}

function normalizeAnchor(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}
