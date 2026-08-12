# Precision study (2026-08-12)

A linter's only capital is trust, so we measure instead of guessing. This is an honest account — including the parts that aren't flattering yet.

## Method

25 public GitHub repos with agent context files (found via code search for root `CLAUDE.md`, sorted by stars) were scanned. From the `dead-path` / `dead-command` findings, random samples were hand-labeled: **round 1 (n=100)** against v0.4.0, then — after fixing every false-positive class round 1 exposed — **round 2 (n=60)** against the patched build. A finding was labeled *true positive* only when the reference, read from the file's own location, would genuinely mislead an agent (moved/deleted file, wrong-scope command). Template placeholders, runtime artifacts, examples, and conventions counted as false positives even when arguably "useful" flags.

## What the rounds found

**Round 1 exposed nine mechanical FP classes**, all fixed and locked in as regression tests (`test/fixtures/fp/`): indented tree listings without box-drawing characters, `YYYYMM/`-style date placeholders, `make <word>` matched in prose, runtime-output paths ("written to…", "created if it does not exist"), `Example:` / `e.g.` lines, `cd dir && npm run x` scoping, Windows drive paths, URI-scheme tokens, `.env` files, copy/move destinations. Total findings across the 25 repos dropped **616 → 468 (−24%)** with zero true positives lost in the fixture suite.

**Round 2 revealed the structural limitation.** Precision is strongly repo-type-dependent:

- On **application repos** (a web app, a CLI tool, a library), sampled findings were mostly genuine drift: root command lists whose scripts live in a workspace package, structure trees pointing at moved directories, docs referencing deleted files.
- On **meta-template repos** (products whose *purpose* is generating other projects — app scaffolds, methodology kits, workflow systems), most findings were false: their context files legitimately describe artifacts that will exist in *generated* projects, not in the repo itself.

Repos with root CLAUDE.md files skew heavily toward the second category, which dominates any naive sample.

## What we conclude (and don't)

We do **not** publish a single headline precision number yet — it would be either misleadingly low (dominated by meta-template repos) or cherry-picked (excluding them). The honest statement is:

> On repos that describe **themselves**, driftlint's error-severity findings are predominantly real drift. On repos that describe **projects they generate**, driftlint currently over-reports; use `.driftlintrc.json` `ignore` globs or the `foreign-context` collapse until the planned template-repo heuristic lands.

Tracking issue: [#5 — detect "describes a generated project" files](https://github.com/alifurkangokce/driftlint/issues/5). Once it lands, this study will be re-run and a headline number published.

## Reproducing

```bash
# any repo
npx @alifurkangokce/driftlint <repo> --json --no-fail
```

Labels and per-round notes are deliberately kept out of the repo to avoid naming other projects' doc bugs; open an issue if you want the methodology details.
