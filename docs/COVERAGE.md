# Test coverage

`pnpm test:coverage` runs every package's suite under V8 instrumentation and
prints what share of its `src` tree executed. It is a measurement, not a gate:
the command asserts nothing, no threshold fails a pull request, and a run with
red tests still reports its numbers. Read it to find the untested corner before
refactoring it, not to close a review.

## How it is wired

- The provider, the reporters and the measured tree live in one place — the
  shared Vitest preset, `packages/config/vitest/vitest.config.ts`. A package
  that re-declares `coverage.include` cannot narrow the tree, because
  `mergeConfig` concatenates arrays instead of replacing them; `coverage.exclude`
  is the only way to measure less, and it costs comparability with every other
  package. `scripts/repo-config.test.mjs` holds that rule, the shape of the
  preset, and the pairing of each package's `test` and `test:coverage` scripts.
- Each package runs `vitest run --coverage` behind its own `test:coverage`;
  `pnpm test:coverage` at the root walks them all through `nx run-many` one
  project at a time, and `nx.json` makes the target depend on `build` and keeps it
  out of the cache. The single-project fan-out is the measurement's own
  requirement, not a style choice — see the note under the snapshot.
- The machine-readable result is `<package>/coverage/coverage-summary.json`,
  which `coverage/` in `.gitignore` keeps out of the repository. That is why the
  snapshot below is committed: without it there is nothing to compare a later
  measurement against.

## Snapshot — 2026-09-27

One-off measurement, not maintained by any gate and not refreshed on release.
The numbers below are statements/branches/functions/lines percentages per
package, with the line counts behind the last column. Measured on this branch
after its rebase, with `dsh-v0.1.7-rc` at `792a6cb9`.

Reproduce it with `pnpm install --frozen-lockfile && pnpm test:coverage` and read
the summaries. The root script carries `--parallel=1` because the fan-out lies:
on the Windows machine this snapshot was taken on, eight projects at a time run
out of memory inside the instrumentation, and the run then reports a package red
while printing no number for it at all — `dsh-qa-surface` and
`dsh-qa-integrations` both died that way on this tree (`FATAL ERROR: Zone
Allocation failed - process out of memory`). A killed worker drops the files it
had not reached, so a parallel number can under-read the package; the paragraph on
red suites below names the one it also turned red for no reason at all.

| Package | Stmts | Br | Fn | Lines | Lines covered |
| --- | --- | --- | --- | --- | --- |
| `@yadsh/dsh-lightrag` | 96.1 | 89.5 | 94.7 | 97.7 | 301/308 |
| `@yadsh/dsh-tool-offload` | 94.8 | 86.9 | 98.4 | 96.2 | 325/338 |
| `@yadsh/dsh-answer-review-gate` | 93.6 | 89.3 | 94.9 | 95.9 | 355/370 |
| `@yadsh/dsh-git-readonly` | 91.9 | 78.8 | 87.7 | 93.9 | 416/443 |
| `@yadsh/dsh-audit-core` | 91.8 | 81.4 | 97.6 | 95.3 | 183/192 |
| `@yadsh/dsh-cas-results` | 90.8 | 84.2 | 85.3 | 92.8 | 673/725 |
| `@yadsh/dsh-l10n-overrides` | 90.7 | 87.2 | 97.1 | 92.4 | 697/754 |
| `@yadsh/dsh-plugin-log` | 87.6 | 75.3 | 83.0 | 90.8 | 295/325 |
| `@yadsh/dsh-qa-integrations` | 84.2 | 73.9 | 82.1 | 86.2 | 5628/6531 |
| `@yadsh/dsh-documents` | 84.1 | 73.6 | 81.1 | 86.3 | 3109/3604 |
| `@yadsh/dsh-jev-compaction` | 83.1 | 77.8 | 73.5 | 85.0 | 1257/1478 |
| `@yadsh/dsh-audit-ui` | 83.1 | 66.5 | 73.6 | 86.0 | 395/459 |
| `@yadsh/dsh-qa-surface` | 82.1 | 76.2 | 75.9 | 84.1 | 12160/14457 |
| `@yadsh/dsh-ui-repair` | 82.0 | 71.1 | 76.7 | 84.2 | 702/834 |
| `@yadsh/dsh-kv-persist` | 81.3 | 75.5 | 71.7 | 84.1 | 593/705 |
| `@yadsh/dsh-user-correction-miner` | 80.9 | 68.7 | 77.9 | 81.3 | 257/316 |
| `@yadsh/dsh-draft-sessions` | 79.9 | 69.0 | 76.0 | 82.4 | 661/802 |
| `@yadsh/dsh-sleev` | 76.8 | 73.3 | 73.2 | 78.2 | 194/248 |
| `@yadsh/dsh-domain-experts` | 74.2 | 74.4 | 61.0 | 75.4 | 1414/1875 |
| `@yadsh/dsh-model-safety-gate` | 73.8 | 70.3 | 66.3 | 76.0 | 910/1198 |
| `@yadsh/dsh-preset-persona-editor` | 72.7 | 61.5 | 61.3 | 76.7 | 622/811 |
| `@yadsh/dsh-session-audit` | 69.9 | 66.1 | 61.7 | 72.4 | 459/634 |
| `@yadsh/dsh-web-fetch-authenticated` | 69.8 | 58.1 | 62.2 | 71.6 | 1815/2535 |
| `@yadsh/dsh-doc-impact` | 60.5 | 54.3 | 55.5 | 62.0 | 668/1077 |
| `@yadsh/dsh-qa-browser` | 58.8 | 56.0 | 60.3 | 60.1 | 961/1599 |
| `@yadsh/dsh-session-scope` | 53.2 | 42.2 | 52.1 | 54.3 | 664/1223 |
| `@yadsh/dsh-prompt-firewall` | 49.3 | 44.9 | 42.7 | 49.6 | 172/347 |
| `@yadsh/dsh-openviking-memory` | 47.7 | 44.9 | 50.3 | 50.2 | 1372/2732 |
| `@yadsh/dsh-plugin-log-ui` | 45.8 | 45.4 | 41.8 | 46.3 | 157/339 |

29 projects measured, 37 415 of 47 259 measured lines executed (79.2%), median
81.3 statements. The aggregate is line-weighted, so `dsh-qa-surface` and
`dsh-qa-integrations` carry two fifths of it between them; the per-package rows
are the readable unit. `@yadsh/dsh-config` and `@yadsh/dsh-plugin-scripts` have
no suite at all, so they are absent by design rather than by failure.

Two rows moved between this snapshot and the one the branch carried before its
rebase although no commit of the base touched either package: `dsh-git-readonly`
covers 416 of its 443 lines here against 417 there, and `dsh-cas-results` 673
against 675. The command was then run a second time on this same tree, and those
two rows came back 417 and 674 while `dsh-qa-surface` moved 12 160 → 12 158 and
every other row repeated exactly. The three packages that wobble read the machine
rather than the repository — `dsh-git-readonly` shells out to a real `git`,
`dsh-cas-results` has a garbage-collection suite keyed on wall-clock age, and
`dsh-qa-surface`'s jsdom suites reach paths in run order — so one or two covered
lines is the noise floor of this measurement. The table records the first of the
two runs; a row that moved by a line or two between two snapshots is not a
finding, and a difference worth reading is a package changing position, not a
count changing by one.

### What this snapshot cannot say about three projects

`@yadsh/dsh-plugin-kit`, `@yadsh/dsh-test-kit` and `@yadsh/dsh-plugin-generator`
have no number here: their suites do not start on this tree. All three extend
`@yadsh/dsh-config/tsconfig/base`, whose own `extends` escapes its package by
three `../` hops, and Vite 8 (which `dsh-v0.1.7-rc` moved onto from Vite 7 while
this card was open) resolves it through the `node_modules/@yadsh/dsh-config`
symlink instead of the real path, so the search lands on
`node_modules/tsconfig.base.json` and every test file fails to transform.
`pnpm nx run-many -t test` fails the same three the same way, with and without
`--coverage` — the defect is in the shared tsconfig preset, not in the
measurement, and fixing it belongs to another card than this one.

They are absent from the table rather than ranked at the bottom, and that
distinction is the reason this section exists: `reportOnFailure` makes each of
them write a summary anyway. `dsh-test-kit` and the generator write an empty one
— no file rows, `pct: "Unknown"`. `dsh-plugin-kit` writes 0.0 over 2 lines: its
summary lists two of the twelve files under `src`, one line each, none executed.
Read straight, that is the worst package in the repository and it is not a
measured package at all.

### Red suites in the measured set

`reportOnFailure` kept the percentage of every package whose suite went red in
the table above, which is the point of the flag. Twenty-five test files across
nine packages failed on this tree, so a low tail reads differently once you know
which rows carry it: `dsh-openviking-memory` (13 files), `dsh-qa-integrations`
(2), `dsh-model-safety-gate` (2), `dsh-prompt-firewall` (2), `dsh-qa-surface`
(2), and one each in `dsh-domain-experts`, `dsh-preset-persona-editor`,
`dsh-web-fetch-authenticated` and `dsh-plugin-log-ui`.

Twenty-four of the twenty-five are not test failures at all: they are collection
errors carrying `SyntaxError: Invalid or unexpected token`. The measurement is not
what puts them in the column — `pnpm nx run-many -t test --parallel=1` over all
thirty-two projects names the same twelve red ones with the same collection errors
file for file, instrumented or not. The one assertion failure inside the measured
set, `qa-settings-card-sections` (`QA Surface card > bounds the request ceiling by
the number the Host validates against`), fails in every shape of the run, on a
product assertion no part of this measurement touches. Two further `dsh-qa-surface`
suites (`settings-sources-section`, `qa-admin-console-overview`) went red in the
thirty-two-project run and passed in the instrumented one and when re-run alone:
that package's own jsdom order dependence, not a property of the measurement, and
not this card's package to fix.

Read the parallelism before reading a percentage as a verdict. The fan-out
described above did not only lose two packages: it also made
`documents-providers-backends` (`libreoffice provider > converts through a
per-job profile`) fail on a real subprocess under eight-way load, a suite that is
green at `--parallel=1`, and pulled `dsh-documents` down to 76.7 statements
against the 84.1 it measures alone.

A failing suite measures its own file as unexecuted, so these percentages are a
floor. `@yadsh/dsh-session-scope` (53.2 / 42.2 branches) and
`@yadsh/dsh-doc-impact` (60.5 / 54.3) are green and still the weakest of the lot,
which is the kind of finding the ratio never made.

## What moved when the denominator became shared

Four plugins measured a subset of their own `src` before the preset took over,
and the preset does not narrow: `mergeConfig` concatenates arrays, so a package
that wants a smaller tree has to reach for `coverage.exclude`. Both columns below
are the *same* tree and the *same* run of the same suite — this branch measured
twice, once with the package's historical `include` restored through
`--coverage.include` — the command line replaces that array where a package config
file would concatenate onto it — and once with it dropped, so the gap is the
denominator alone, with not a single test changed:

| Package | Measured before | Stmts | Lines | Measured after | Stmts | Lines |
| --- | --- | --- | --- | --- | --- | --- |
| `@yadsh/dsh-session-audit` | `src/host/**/*.ts` + `src/config.ts` | 80.1 | 359/433 | all of `src` | 69.9 | 459/634 |
| `@yadsh/dsh-draft-sessions` | `src/host/**/*.ts` + `src/shared/**/*.ts` | 89.0 | 136/150 | all of `src` | 79.9 | 661/802 |
| `@yadsh/dsh-sleev` | `src/host/**/*.ts` + `src/shared/**/*.ts` | 89.7 | 91/98 | all of `src` | 76.8 | 194/248 |
| `@yadsh/dsh-qa-browser` | `src/**/*.ts` | 60.8 | 961/1550 | all of `src`, `.tsx` included | 58.8 | 961/1599 |

The percentage falls in every row while the executed code grows in three of them:
`dsh-draft-sessions` reported 136 covered lines against its own tree and 661
against the whole one. The wider denominator did not uncover an untested client;
it stopped hiding a tested one in the count.

`dsh-qa-browser` is the row that makes the arithmetic visible: its own glob was
`src/**/*.ts`, forty-nine measured lines from the preset's tree, so it moved
60.8 → 58.8 with 961 covered lines in both columns. A package whose old tree
already nearly matched the preset's gains almost nothing from the change, which
is the reason the four are listed with their numbers rather than folded into one
sentence.

`@yadsh/dsh-qa-integrations` configured a reporter list and no tree at all, and
`@yadsh/dsh-ui-repair` had no Vitest config; neither had ever been measured, so
neither appears above.

## The ratio this replaced

Refactor planning ranked packages by lines of test code per line of `src`. That
ratio is not a coverage number: it grows whenever a package gains tests of any
quality, it is easiest to win on a small package with a large suite, and it never
names a statement. Against the snapshot above it agrees only weakly — Spearman
rho 0.42 over the 28 projects the catalog scored and this tree could measure —
and it errs in both directions. It called `audit-ui` the worst (30) while it
measures 83.1 statements, mid-table; it called `session-scope` healthy (63) while
its 53.2 / 42.2 branches is the weakest green suite in the repository; and its
best score, `l10n-overrides` at 205, measures 90.7 — a real number, but the
ranking placed it above packages that measure better. So the ratio was a ranking
of effort, not of risk, and it cannot point at the corner that is untested.
Compare this table with another measurement of the same tree; never with a line
count.
