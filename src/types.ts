export type Severity = "error" | "warning" | "info";

export interface Finding {
  rule:
    | "dead-path"
    | "dead-command"
    | "skill-budget"
    | "stale-knowledge"
    | "foreign-context"
    | "narrative-claim"
    | "template-context"
    | "load-budget"
    | "missing-rationale"
    | "twin-drift"
    | "untracked-context";
  severity: Severity;
  /** Context file the claim lives in, relative to the scanned root. */
  file: string;
  /** 1-based line number of the claim (0 = file-level finding). */
  line: number;
  message: string;
  hint?: string;
  /** Present when the finding has exactly one safe, mechanical fix. */
  fix?: {
    oldText: string;
    newText: string;
  };
}

export interface ContextFile {
  /** Path relative to the scanned root. */
  path: string;
  kind:
    | "claude-md"
    | "agents-md"
    | "skill"
    | "subagent"
    | "command"
    | "cursor-rule"
    | "copilot"
    | "gemini"
    | "windsurf"
    | "cline"
    | "opencode"
    | "memory";
  content: string;
  lines: string[];
}

export interface PathRef {
  raw: string;
  line: number;
}

export interface CommandRef {
  kind: "npm-script" | "make-target";
  name: string;
  line: number;
  /** Working directory when the instruction says `cd <dir> && ...`. */
  cwd?: string;
}

export interface RepoIndex {
  root: string;
  /** basename -> repo-relative paths that end with that basename (files and dirs). */
  basenames: Map<string, string[]>;
}

export interface ScanResult {
  root: string;
  contextFiles: string[];
  findings: Finding[];
  /** Reference-health stats behind the 0-100 freshness score. */
  stats: {
    refsChecked: number;
    refsBroken: number;
    /** 100 = every checked path reference resolves. Errors only; collapsed
     *  template/foreign files are excluded so they can't skew the score. */
    score: number;
  };
}
