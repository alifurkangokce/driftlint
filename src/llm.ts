import * as fs from "node:fs";
import * as path from "node:path";
import { walk, type WalkEntry } from "./fswalk.js";
import { discoverContextFiles } from "./discover.js";
import { globToRegex, type DriftlintConfig } from "./scan.js";
import type { ContextFile, Finding } from "./types.js";

/**
 * Optional LLM pass: extract narrative claims from context files ("auth goes
 * through the BFF", "we use PostgreSQL") and verify them against the code.
 * Deterministic checks can't see these; an LLM can. Runs ONLY behind --llm,
 * with the caller's own Anthropic credentials — zero behavior change without it.
 */

export const DEFAULT_LLM_MODEL = "claude-opus-5";

const MAX_FILES = 10;
const MAX_FILE_CHARS = 12_000;
const MAX_CLAIMS_PER_FILE = 8;
const MAX_KEYWORDS_PER_CLAIM = 5;
const MAX_SNIPPETS_PER_CLAIM = 6;
const MAX_SNIPPET_CHARS = 200;
const MAX_EVIDENCE_FILES = 4000;
const MAX_SCAN_FILE_BYTES = 262_144;

export interface Claim {
  claim: string;
  line: number;
  keywords: string[];
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/** One structured-output completion. `data` is null when the model refused. */
export type CompleteFn = (
  system: string,
  user: string,
  schema: object,
) => Promise<{ data: unknown; usage: LlmUsage }>;

const EXTRACT_SYSTEM = `You are the claim extractor of driftlint, a linter that finds drift between agent context files and the code they describe.
Extract VERIFIABLE claims about THIS repository from the given context file: assertions about architecture, behavior, technology choices, or where things live, that could be confirmed or contradicted by reading the code.
Skip instructions to the agent, opinions, generic advice, and claims about external systems.
For each claim give the 1-based line number it appears on and 2-5 search keywords: identifiers, file names, or distinctive strings likely to appear in the code if the claim is true.`;

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          line: { type: "integer" },
          keywords: { type: "array", items: { type: "string" } },
        },
        required: ["claim", "line", "keywords"],
        additionalProperties: false,
      },
    },
  },
  required: ["claims"],
  additionalProperties: false,
} as const;

const VERIFY_SYSTEM = `You are the claim verifier of driftlint. For each claim about a repository you get evidence snippets gathered by grepping the claim's keywords across the codebase.
Judge each claim: "supported" (evidence is consistent with it), "contradicted" (evidence actively conflicts with it), or "unverifiable" (not enough evidence either way).
Be conservative: absence of evidence is "unverifiable", NEVER "contradicted". Only report "contradicted" when a snippet directly conflicts with the claim. Keep explanations to one sentence.`;

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          verdict: { type: "string", enum: ["supported", "contradicted", "unverifiable"] },
          explanation: { type: "string" },
        },
        required: ["index", "verdict", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
} as const;

/** Create the real completion function. Fails with install/auth guidance —
 *  the SDK is an optional peer dependency so plain `npx driftlint` stays light. */
export async function createAnthropicComplete(model: string): Promise<CompleteFn> {
  let AnthropicCtor: new () => unknown;
  try {
    const mod = (await import("@anthropic-ai/sdk")) as { default: new () => unknown };
    AnthropicCtor = mod.default;
  } catch {
    throw new Error(
      "--llm needs the optional @anthropic-ai/sdk package. Install it next to driftlint, e.g. `npm install @anthropic-ai/sdk` in your project (or -g).",
    );
  }
  // The SDK resolves credentials itself (ANTHROPIC_API_KEY, ant auth profile, ...).
  const client = new AnthropicCtor() as {
    beta: { messages: { create: (req: object) => Promise<Record<string, unknown>> } };
  };

  return async (system, user, schema) => {
    const response = (await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } },
    })) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const usage: LlmUsage = {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
    if (response.stop_reason === "refusal") return { data: null, usage };
    const text = response.content?.find((b) => b.type === "text")?.text ?? "";
    try {
      return { data: JSON.parse(text), usage };
    } catch {
      return { data: null, usage };
    }
  };
}

const TEXT_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx", "yml", "yaml",
  "toml", "py", "rb", "go", "rs", "java", "kt", "cs", "csx", "php", "cpp",
  "cc", "c", "h", "hpp", "sh", "sql", "html", "css", "scss", "xml", "proto",
  "tf", "ini", "cfg", "conf", "env", "gradle", "swift", "fs", "vue", "svelte",
]);

function isTextCandidate(rel: string): boolean {
  const base = rel.split("/").pop() ?? "";
  if (base === "Dockerfile" || base === "Makefile") return true;
  const ext = base.split(".").pop() ?? "";
  return TEXT_EXTS.has(ext.toLowerCase());
}

/** Grep the claim's keywords across the repo; returns `file:line: text` snippets. */
export function buildEvidence(
  root: string,
  files: string[],
  keywords: string[],
  cache: Map<string, string[] | null> = new Map(),
): string[] {
  const snippets: string[] = [];
  for (const keyword of keywords.slice(0, MAX_KEYWORDS_PER_CLAIM)) {
    const needle = keyword.toLowerCase();
    if (needle.length < 3) continue;
    for (const rel of files) {
      if (snippets.length >= MAX_SNIPPETS_PER_CLAIM) return snippets;
      let lines = cache.get(rel);
      if (lines === undefined) {
        try {
          const p = path.join(root, rel);
          lines = fs.statSync(p).size > MAX_SCAN_FILE_BYTES
            ? null
            : fs.readFileSync(p, "utf8").split(/\r?\n/);
        } catch {
          lines = null;
        }
        cache.set(rel, lines);
      }
      if (!lines) continue;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line && line.toLowerCase().includes(needle)) {
          snippets.push(`${rel}:${i + 1}: ${line.trim().slice(0, MAX_SNIPPET_CHARS)}`);
          break; // one hit per file per keyword keeps evidence diverse
        }
      }
    }
  }
  return snippets;
}

export interface LlmPassResult {
  findings: Finding[];
  usage: LlmUsage;
  claimsChecked: number;
  filesChecked: number;
}

export async function runLlmPass(
  root: string,
  opts: { complete: CompleteFn; config?: DriftlintConfig },
): Promise<LlmPassResult> {
  const entries: WalkEntry[] = walk(root);
  const ignoreRes = (opts.config?.ignore ?? []).map(globToRegex);
  const rank = (f: ContextFile) =>
    f.kind === "claude-md" || f.kind === "agents-md" || f.kind === "gemini" ? 0 : 1;
  const files = discoverContextFiles(root, entries)
    .filter((f) => !ignoreRes.some((r) => r.test(f.path)))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_FILES);

  const evidenceFiles = entries
    .filter((e) => !e.isDir && isTextCandidate(e.rel))
    .map((e) => e.rel)
    .slice(0, MAX_EVIDENCE_FILES);
  const evidenceCache = new Map<string, string[] | null>();

  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  const findings: Finding[] = [];
  let claimsChecked = 0;

  for (const file of files) {
    const content = file.content.slice(0, MAX_FILE_CHARS);
    const extracted = await opts.complete(
      EXTRACT_SYSTEM,
      `Context file \`${file.path}\`:\n\n${content}`,
      EXTRACT_SCHEMA,
    );
    usage.inputTokens += extracted.usage.inputTokens;
    usage.outputTokens += extracted.usage.outputTokens;
    if (!extracted.data) continue;

    const claims = (((extracted.data as { claims?: Claim[] }).claims ?? []) as Claim[])
      .filter((c) => c && typeof c.claim === "string" && Array.isArray(c.keywords))
      .slice(0, MAX_CLAIMS_PER_FILE);
    if (claims.length === 0) continue;
    claimsChecked += claims.length;

    const evidenceBlocks = claims.map((c, i) => {
      const snippets = buildEvidence(root, evidenceFiles, c.keywords, evidenceCache);
      return `## Claim ${i}\n"${c.claim}"\nEvidence:\n${snippets.length ? snippets.join("\n") : "(no matches found)"}`;
    });
    const verified = await opts.complete(
      VERIFY_SYSTEM,
      `Repository claims from \`${file.path}\`:\n\n${evidenceBlocks.join("\n\n")}`,
      VERIFY_SCHEMA,
    );
    usage.inputTokens += verified.usage.inputTokens;
    usage.outputTokens += verified.usage.outputTokens;
    if (!verified.data) continue;

    for (const v of (verified.data as { verdicts?: Array<{ index: number; verdict: string; explanation: string }> }).verdicts ?? []) {
      const claim = claims[v.index];
      if (!claim || v.verdict !== "contradicted") continue;
      findings.push({
        rule: "narrative-claim",
        severity: "warning",
        file: file.path,
        line: Number.isInteger(claim.line) && claim.line > 0 ? claim.line : 0,
        message: `claim "${claim.claim.slice(0, 140)}" appears contradicted by the code.`,
        hint: `${v.explanation.slice(0, 200)} (LLM-verified — needs review)`,
      });
    }
  }

  return { findings, usage, claimsChecked, filesChecked: files.length };
}
