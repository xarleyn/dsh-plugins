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
  `pnpm test:coverage` at the root walks them all through `nx run-many`, and
  `nx.json` makes the target depend on `build` and keeps it out of the cache.
- The machine-readable result is `<package>/coverage/coverage-summary.json`,
  which `coverage/` in `.gitignore` keeps out of the repository. That is why the
  snapshot below is committed: without it there is nothing to compare a later
  measurement against.

## Snapshot — 2026-09-26

One-off measurement, not maintained by any gate and not refreshed on release.
Reproduce it with `pnpm install --frozen-lockfile && pnpm test:coverage` and read
the summaries; the numbers below are statements/branches/functions/lines
percentages per package, with the line counts behind the last column. Measured
on `dsh-v0.1.7-rc` merged into this branch (`848e1cf`).

| Package | Stmts | Br | Fn | Lines | Lines covered |
| --- | --- | --- | --- | --- | --- |
| `@yadsh/dsh-lightrag` | 96.1 | 89.5 | 94.7 | 97.7 | 301/308 |
| `@yadsh/dsh-tool-offload` | 94.8 | 86.9 | 98.4 | 96.2 | 325/338 |
| `@yadsh/dsh-answer-review-gate` | 93.6 | 89.3 | 94.9 | 95.9 | 355/370 |
| `@yadsh/dsh-git-readonly` | 92.1 | 79.7 | 89.0 | 94.1 | 417/443 |
| `@yadsh/dsh-audit-core` | 91.8 | 81.4 | 97.6 | 95.3 | 183/192 |
| `@yadsh/dsh-cas-results` | 90.8 | 84.2 | 85.3 | 92.8 | 673/725 |
| `@yadsh/dsh-l10n-overrides` | 90.4 | 87.0 | 96.9 | 92.2 | 684/742 |
| `@yadsh/dsh-plugin-log` | 87.4 | 74.4 | 82.8 | 90.6 | 290/320 |
| `@yadsh/dsh-qa-integrations` | 84.1 | 74.0 | 81.9 | 86.1 | 5615/6523 |
| `@yadsh/dsh-documents` | 83.6 | 73.1 | 80.9 | 85.8 | 3092/3604 |
| `@yadsh/dsh-jev-compaction` | 83.1 | 77.8 | 73.5 | 85.0 | 1257/1478 |
| `@yadsh/dsh-audit-ui` | 83.1 | 66.5 | 73.6 | 86.0 | 395/459 |
| `@yadsh/dsh-qa-surface` | 82.1 | 76.1 | 75.8 | 84.0 | 12150/14458 |
| `@yadsh/dsh-ui-repair` | 82.0 | 71.1 | 76.7 | 84.2 | 702/834 |
| `@yadsh/dsh-kv-persist` | 81.0 | 75.5 | 71.3 | 83.9 | 574/684 |
| `@yadsh/dsh-user-correction-miner` | 80.9 | 68.7 | 77.9 | 81.3 | 257/316 |
| `@yadsh/dsh-draft-sessions` | 79.9 | 69.0 | 76.0 | 82.4 | 661/802 |
| `@yadsh/dsh-sleev` | 76.8 | 73.3 | 73.2 | 78.2 | 194/248 |
| `@yadsh/dsh-model-safety-gate` | 73.8 | 70.3 | 66.3 | 76.0 | 910/1198 |
| `@yadsh/dsh-domain-experts` | 73.1 | 73.1 | 64.2 | 74.3 | 1382/1860 |
| `@yadsh/dsh-preset-persona-editor` | 72.7 | 61.5 | 61.3 | 76.7 | 622/811 |
| `@yadsh/dsh-web-fetch-authenticated` | 69.8 | 58.1 | 62.3 | 71.6 | 1815/2534 |
| `@yadsh/dsh-session-audit` | 67.0 | 62.0 | 60.0 | 69.4 | 408/588 |
| `@yadsh/dsh-doc-impact` | 60.5 | 54.3 | 55.5 | 62.0 | 668/1077 |
| `@yadsh/dsh-qa-browser` | 58.6 | 55.8 | 60.1 | 60.0 | 933/1556 |
| `@yadsh/dsh-session-scope` | 53.1 | 42.2 | 52.0 | 54.3 | 663/1222 |
| `@yadsh/dsh-openviking-memory` | 47.7 | 44.9 | 50.3 | 50.2 | 1372/2732 |
| `@yadsh/dsh-prompt-firewall` | 47.2 | 40.1 | 41.9 | 47.8 | 166/347 |
| `@yadsh/dsh-plugin-log-ui` | 45.8 | 45.4 | 41.8 | 46.3 | 157/339 |

29 projects measured, 37 221 of 47 108 measured lines executed (79.0%), median
81.0 statements. The aggregate is line-weighted, so `dsh-qa-surface` and
`dsh-qa-integrations` carry nearly half of it between them; the per-package rows
are the readable unit. `@yadsh/dsh-config` and `@yadsh/dsh-plugin-scripts` have
no suite at all, so they are absent by design rather than by failure.

### What this snapshot cannot say about four projects

`@yadsh/dsh-plugin-kit`, `@yadsh/dsh-test-kit` and `@yadsh/dsh-plugin-generator`
have no number here: their suites do not start on this tree. All three extend
`@yadsh/dsh-config/tsconfig/base`, whose own `extends` escapes its package by
three `../` hops, and Vite 8 (which `dsh-v0.1.7-rc` moved onto from Vite 7 while
this card was open) resolves it through the `node_modules/@yadsh/dsh-config`
symlink instead of the real path, so the search lands on
`node_modules/tsconfig.base.json` and every test file fails to transform. Plain
`pnpm test` fails the same three the same way, with and without `--coverage` —
the defect is in the shared tsconfig preset, not in the measurement, and fixing
it belongs to another card than this one.

`@yadsh/dsh-domain-experts` was measured by running `vitest run --coverage` in
the package directly: its `build` target is red on this tree (the typert
generator rejects `installSection` against the pinned host catalog), so `nx`
skipped its `test:coverage` on a dependency, not on its own tests. The number
above is real, the path to it is not the one `pnpm test:coverage` takes.

### Red suites in the measured set

`reportOnFailure` kept the percentage of every package whose suite went red in
the table above, which is the point of the flag. Twenty-four test files across
eight packages failed on this tree, identically with and without `--coverage`, so
a low tail reads differently once you know which rows carry it: `dsh-openviking-memory` (13
files), `dsh-qa-integrations` (2), `dsh-model-safety-gate` (2),
`dsh-prompt-firewall` (2), and one each in `dsh-qa-surface`,
`dsh-preset-persona-editor`, `dsh-web-fetch-authenticated` and
`dsh-plugin-log-ui`. A failing suite measures its own file as unexecuted, so
these percentages are a floor. `@yadsh/dsh-session-scope` (53.1 / 42.2 branches)
and `@yadsh/dsh-doc-impact` (60.5 / 54.3) are green and still the weakest of the
lot, which is the kind of finding the ratio never made.

## What moved when the denominator became shared

Three plugins measured a subset of their own `src` before the preset took over,
and the preset does not narrow. Both columns below come from the same tree
(2026-09-25, the run that introduced the preset), so the gap is the denominator
alone and not a single test changed:

| Package | Measured before | Stmts (narrowed) | Measured after | Stmts (shared) |
| --- | --- | --- | --- | --- |
| `@yadsh/dsh-session-audit` | `src/host/**` + `src/config.ts` | 76.2 | all of `src` | 64.2 |
| `@yadsh/dsh-draft-sessions` | `src/host/**` + `src/shared/**` | 89.0 | all of `src` | 80.0 |
| `@yadsh/dsh-sleev` | `src/host/**` + `src/shared/**` | 89.5 | all of `src` | 78.1 |

`@yadsh/dsh-qa-browser` repeated the preset's own `include` and gained nothing
from it; `@yadsh/dsh-qa-integrations` configured a reporter list and no tree at
all; `@yadsh/dsh-ui-repair` had no Vitest config, so it had never been measured.

The same three packages in the snapshot above moved again (67.0, 79.9, 76.8),
and that second move is the code, not the denominator: the tree between the two
runs grew, so only the row-to-row percentage of one run is a denominator
statement.

## The ratio this replaced

Refactor planning ranked packages by lines of test code per line of `src`. That
ratio is not a coverage number: it grows whenever a package gains tests of any
quality, it is easiest to win on a small package with a large suite, and it never
names a statement. Against the snapshot above it agrees only weakly — Spearman
rho 0.43 over the 28 projects the catalog scored and this tree could measure —
and it errs in both directions. It called `audit-ui` the worst (30) while it
measures 83.1 statements, mid-table; it called `session-scope` healthy (63) while
its 53.1 / 42.2 branches is the weakest green suite in the repository; and its
best score, `l10n-overrides` at 205, measures 90.4 — a real number, but the
ranking placed it above packages that measure better. So the ratio was a ranking
of effort, not of risk, and it cannot point at the corner that is untested.
Compare this table with another measurement of the same tree; never with a line
count.
