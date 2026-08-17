/** Library surface — everything the MCP server, editors, and integrations need. */
export { scan, loadConfig, applyRuleOverrides, applyBaseline, loadBaseline, writeBaseline, fingerprint, globToRegex } from "./scan.js";
export type { DriftlintConfig, ScanOptions } from "./scan.js";
export { diffScan, resolveBaseline } from "./diff.js";
export type { DiffScanResult } from "./diff.js";
export { checkReference } from "./reference.js";
export type { ReferenceCheck } from "./reference.js";
export { toSarif } from "./sarif.js";
export { toRdjsonl } from "./rdjsonl.js";
export { badgeJson } from "./badge.js";
export type { Finding, ScanResult, Severity, ContextFile } from "./types.js";
