#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs";
import { z } from "zod";
import { checkReference, diffScan, scan } from "@alifurkangokce/driftlint";

/**
 * driftlint as an MCP server — the linter for AI context files, itself
 * agent-callable. Lint-only by philosophy (like @eslint/mcp): the server
 * reports findings and suggested fixes; applying them is the agent's job.
 */

// read from the manifest so the advertised version can't drift from the package
const { version } = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const server = new McpServer({ name: "driftlint", version });

server.tool(
  "drift_scan",
  "Scan a repository's agent context files (CLAUDE.md, AGENTS.md, skills, subagents) for drift against the codebase: dead paths (with did-you-mean fixes), dead commands, load-budget overflows, stale knowledge. Pass diff_range (e.g. 'origin/main...HEAD') to report only drift that change caused.",
  {
    path: z.string().default(".").describe("Repository root to scan (absolute or relative to the server cwd)"),
    diff_range: z
      .string()
      .optional()
      .describe("Git range for PR-diff mode — only findings NEW versus the merge-base are returned"),
  },
  async ({ path, diff_range }) => {
    const result = diff_range ? diffScan(path, diff_range) : scan(path);
    const payload = {
      score: result.stats.score,
      summary: {
        errors: result.findings.filter((f) => f.severity === "error").length,
        warnings: result.findings.filter((f) => f.severity === "warning").length,
        contextFiles: result.contextFiles.length,
      },
      findings: result.findings.map((f) => ({
        rule: f.rule,
        severity: f.severity,
        file: f.file,
        line: f.line,
        message: f.message,
        ...(f.hint ? { hint: f.hint } : {}),
        ...(f.fix ? { fix: f.fix } : {}),
      })),
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  },
);

server.tool(
  "drift_check",
  "Verify a single reference BEFORE writing it into a context file: a file path ('src/auth.ts'), an npm script name ('deploy:prod') or a make target. Returns ok plus suggestions when it doesn't resolve. Call this before editing CLAUDE.md/AGENTS.md so you never write a dead reference.",
  {
    path: z.string().default(".").describe("Repository root"),
    reference: z.string().describe("The path, npm script or make target you are about to reference"),
  },
  async ({ path, reference }) => {
    const result = checkReference(path, reference);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
