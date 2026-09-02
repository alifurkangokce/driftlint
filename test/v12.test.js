import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scan } from "../dist/scan.js";
import { auditMemory } from "../dist/memoryAudit.js";

function tmp(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driftlint-v12-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const links = (dir) => scan(dir).findings.filter((f) => f.rule === "dead-link");

test("dead-link: missing target file errors with a did-you-mean fix", () => {
  const dir = tmp({
    "CLAUDE.md": "# App\n\nDeployment steps: [deploy guide](docs/deploy.md)\n",
    "guides/deploy.md": "# Deploy\n",
  });
  const found = links(dir);
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "error");
  assert.match(found[0].message, /`docs\/deploy\.md` does not exist/);
  assert.match(found[0].hint, /guides\/deploy\.md/);
  assert.deepEqual(found[0].fix, { oldText: "docs/deploy.md", newText: "guides/deploy.md" });
});

test("dead-link: resolvable links and anchors stay silent", () => {
  const dir = tmp({
    "CLAUDE.md":
      "# App\n\nSee [deploy](docs/deploy.md#staging-rollout), [readme](README.md), [top](#app) and [line](src/app.ts#L12).\n",
    "docs/deploy.md": "# Deploy\n\n## Staging rollout\n\nSteps here.\n",
    "README.md": "# Readme\n",
    "src/app.ts": "export {};\n",
  });
  assert.deepEqual(links(dir), []);
});

test("dead-link: renamed heading warns with the closest anchor as a fix", () => {
  const dir = tmp({
    "CLAUDE.md": "# App\n\nRelease process: [staging](docs/deploy.md#staging)\n",
    "docs/deploy.md": "# Deploy\n\n## Staging rollout\n",
  });
  const found = links(dir);
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warning");
  assert.match(found[0].message, /no `#staging` heading/);
  assert.deepEqual(found[0].fix, { oldText: "#staging", newText: "#staging-rollout" });
});

test("dead-link: duplicate headings, explicit ids and code-fence headings resolve correctly", () => {
  const dir = tmp({
    "CLAUDE.md":
      "# App\n\n[a](docs/x.md#setup) [b](docs/x.md#setup-1) [c](docs/x.md#custom) [d](docs/x.md#html-anchor) [e](docs/x.md#not-a-heading)\n",
    "docs/x.md":
      '# X\n\n## Setup\n\n## Setup\n\n## Extras {#custom}\n\n<a name="html-anchor"></a>\n\n```md\n## Not a heading\n```\n',
  });
  const found = links(dir);
  assert.equal(found.length, 1, "only the fenced heading must be missing");
  assert.match(found[0].message, /#not-a-heading/);
});

test("dead-link: external, absolute, templated and future-file links are skipped", () => {
  const dir = tmp({
    "CLAUDE.md": [
      "# App",
      "",
      "[site](https://example.com/docs) [mail](mailto:x@example.com) [abs](/docs/x.md)",
      "[tpl](docs/{name}.md) [ph](path/to/file.md) [up](../outside/thing.md)",
      "The report is written to [report](out/report.md) when the job runs.",
    ].join("\n"),
  });
  assert.deepEqual(links(dir), []);
});

test("dead-link: links inside fences and driftlint-ignore lines are skipped", () => {
  const dir = tmp({
    "CLAUDE.md":
      "# App\n\n```md\n[example](docs/gone.md)\n```\n\n[ignored](docs/gone.md) <!-- driftlint-ignore -->\n",
  });
  assert.deepEqual(links(dir), []);
});

test("dead-link: reference usages resolve once and report definition lines", () => {
  const dir = tmp({
    "CLAUDE.md": [
      "# App",
      "[readme]: README.md",
      "",
      "See [readme][], [deploy][ DePloY ], [architecture][arch], and ![removed][gone] plus [again][gone].",
      "The generated report will be created at [report][report].",
      "",
      "[deploy]: docs/deploy.md#staging",
      "[arch]: docs/architecture.md#components",
      "[gone]: docs/gone.png",
      "[gone]: README.md",
      "[report]: docs/report.md",
    ].join("\n"),
    "README.md": "# Readme\n",
    "docs/deploy.md": "# Deploy\n\n## Staging\n",
    "docs/architecture.md": "# Architecture\n\n## Components\n",
  });
  const found = links(dir);
  assert.equal(found.length, 1, "repeated usages share the first definition");
  assert.equal(found[0].line, 9, "the editable definition owns the finding");
  assert.match(found[0].message, /`docs\/gone\.png` does not exist/);
});

test("dead-link: unused, undefined, fenced, ignored, and non-repo references stay silent", () => {
  const dir = tmp({
    "CLAUDE.md": [
      "# App",
      "",
      "[undefined][missing] [external][external] [absolute][absolute] [template][template] [placeholder][placeholder]",
      "[ignored][ignored] <!-- driftlint-ignore -->",
      "[hidden][hidden] has its definition only in a fence.",
      "[inline](README.md \"[title][title]\") and \\[escaped][escaped] stay inline or escaped.",
      "",
      "```md",
      "[fenced][fenced]",
      "[hidden]: docs/hidden.md",
      "```",
      "",
      "[external]: <https://example.com/docs>",
      "[absolute]: /docs/absolute.md",
      "[template]: docs/{name}.md",
      "[placeholder]: path/to/file.md",
      "[ignored]: docs/ignored.md",
      "[fenced]: docs/fenced.md",
      "[title]: docs/title.md",
      "[escaped]: docs/escaped.md",
      "[unused]: docs/unused.md",
    ].join("\n"),
    "README.md": "# Readme\n",
  });
  assert.deepEqual(links(dir), []);
});

test("dead-link: reference findings omit ambiguous auto-fixes", () => {
  const dir = tmp({
    "CLAUDE.md": [
      "# App",
      "",
      "See [missing][docs/missing.md].",
      "",
      "[docs/missing.md]: docs/missing.md",
    ].join("\n"),
    "guides/missing.md": "# Found\n",
  });
  const found = links(dir);
  assert.equal(found.length, 1);
  assert.match(found[0].hint, /guides\/missing\.md/);
  assert.equal(found[0].fix, undefined);
});

test("dead-link: memory audit validates MEMORY.md index pointers", () => {
  const repo = tmp({ "src/app.ts": "export {};\n" });
  const memory = tmp({
    "MEMORY.md": "# Index\n\n- [Entry](app-entry.md) — good\n- [Gone](deleted-topic.md) — bad\n",
    "app-entry.md": "Entry is `src/app.ts`.\n",
  });
  const found = auditMemory(repo, memory).findings.filter((f) => f.rule === "dead-link");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /deleted-topic\.md/);
});
