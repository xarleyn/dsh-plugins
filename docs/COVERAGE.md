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
after its rebase, with `dsh-v0.1.7-rc` at `0dbbd0d1`.

Reproduce it with `pnpm install --frozen-lockfile && pnpm test:coverage` and read
the summaries. The root script carries `--parallel=1` because the command's own
contract is "print a number for every package", and a worker the instrumenter
kills leaves no summary behind, so a fan-out silently drops packages instead of
reporting them. This machine showed the same failure mode in serial form while the
snapshot was being taken: one run of `pnpm test:coverage` died with
`FATAL ERROR: Zone Allocation failed - process out of memory` inside
`@yadsh/dsh-qa-surface:build`, under the pressure of the other worktrees on the
box, and printed no number for any of the 32 projects. The recorded numbers come
from the serial run that completed, cross-checked against a second pass taken one
project at a time with a retry whenever a summary was missing; the paragraph under
the table names the three rows the two passes do not agree on.

| Package | Stmts | Br | Fn | Lines | Lines covered |
| --- | --- | --- | --- | --- | --- |
| `@yadsh/dsh-lightrag` | 96.1 | 89.5 | 94.7 | 97.7 | 301/308 |
| `@yadsh/dsh-tool-offload` | 94.8 | 86.9 | 98.4 | 96.2 | 325/338 |
| `@yadsh/dsh-answer-review-gate` | 93.6 | 89.3 | 94.9 | 95.9 | 355/370 |
| `@yadsh/dsh-git-readonly` | 92.1 | 79.7 | 89.0 | 94.1 | 417/443 |
| `@yadsh/dsh-audit-core` | 91.8 | 81.4 | 97.6 | 95.3 | 183/192 |
| `@yadsh/dsh-cas-results` | 91.0 | 84.4 | 86.0 | 93.0 | 674/725 |
| `@yadsh/dsh-l10n-overrides` | 90.7 | 87.2 | 97.1 | 92.4 | 697/754 |
| `@yadsh/dsh-plugin-log` | 87.6 | 75.3 | 83.0 | 90.8 | 295/325 |
| `@yadsh/dsh-qa-integrations` | 86.1 | 74.6 | 84.5 | 88.8 | 5793/6522 |
| `@yadsh/dsh-model-safety-gate` | 84.2 | 77.0 | 75.7 | 86.6 | 1040/1201 |
| `@yadsh/dsh-documents` | 84.1 | 73.6 | 81.1 | 86.3 | 3109/3604 |
| `@yadsh/dsh-domain-experts` | 84.0 | 78.3 | 76.3 | 86.5 | 1647/1904 |
| `@yadsh/dsh-qa-surface` | 83.2 | 76.8 | 77.0 | 85.6 | 12508/14611 |
| `@yadsh/dsh-jev-compaction` | 83.1 | 77.8 | 73.5 | 85.0 | 1257/1478 |
| `@yadsh/dsh-audit-ui` | 83.1 | 66.5 | 73.6 | 86.0 | 395/459 |
| `@yadsh/dsh-ui-repair` | 82.0 | 71.1 | 76.7 | 84.2 | 702/834 |
| `@yadsh/dsh-kv-persist` | 81.3 | 75.5 | 71.7 | 84.1 | 593/705 |
| `@yadsh/dsh-user-correction-miner` | 80.9 | 68.7 | 77.9 | 81.3 | 257/316 |
| `@yadsh/dsh-draft-sessions` | 79.9 | 69.0 | 76.0 | 82.4 | 661/802 |
| `@yadsh/dsh-sleev` | 76.8 | 73.3 | 73.2 | 78.2 | 194/248 |
| `@yadsh/dsh-preset-persona-editor` | 74.7 | 63.7 | 64.4 | 79.7 | 655/822 |
| `@yadsh/dsh-openviking-memory` | 72.2 | 63.5 | 75.3 | 75.5 | 2065/2735 |
| `@yadsh/dsh-web-fetch-authenticated` | 72.0 | 59.4 | 65.1 | 74.1 | 1885/2543 |
| `@yadsh/dsh-session-audit` | 67.8 | 66.1 | 61.0 | 70.9 | 459/647 |
| `@yadsh/dsh-prompt-firewall` | 62.9 | 50.6 | 55.5 | 63.7 | 225/353 |
| `@yadsh/dsh-doc-impact` | 60.5 | 54.3 | 55.4 | 62.0 | 667/1076 |
| `@yadsh/dsh-qa-browser` | 58.8 | 56.0 | 60.3 | 60.1 | 961/1599 |
| `@yadsh/dsh-plugin-log-ui` | 57.9 | 48.8 | 53.1 | 58.8 | 203/345 |
| `@yadsh/dsh-session-scope` | 53.2 | 42.2 | 52.1 | 54.3 | 664/1223 |

29 projects measured, 39 187 of 47 482 measured lines executed (82.5%), median
83.1 statements. The aggregate is line-weighted, so `dsh-qa-surface` and
`dsh-qa-integrations` carry two fifths of it between them; the per-package rows
are the readable unit. `@yadsh/dsh-plugin-scripts` runs no vitest suite and is
absent by design; `@yadsh/dsh-config` does run one — it tests the Vitest preset
itself — but ships no `src`, so the preset's `include` has no tree to instrument
and the contract test names that package on every run instead of letting it drop
out silently.

Two passes over this tree disagree in three rows and agree in the other 26:
`dsh-cas-results` covered 673 lines in one and 674 in the other, `dsh-documents`
3112 and 3109, `dsh-qa-surface` 12 506 and 12 508, and no percentage moved by more
than a tenth of a point. So up to three covered lines is the noise floor of this
measurement, not a finding. Both of the packages that moved read the machine rather
than the repository: `dsh-cas-results` has a garbage-collection suite keyed on
wall-clock age and `dsh-documents` drives a `libreoffice` subprocess.
`dsh-git-readonly`, the other suite that shells out to a real `git`, repeated its
417/443 exactly. A row that moved by a few lines between two snapshots is not a
change in what the tests exercise.

### What this snapshot cannot say about three projects

`@yadsh/dsh-plugin-kit`, `@yadsh/dsh-test-kit` and `@yadsh/dsh-plugin-generator`
have no number here: their suites do not start on this tree. All three inherited
`@yadsh/dsh-config/tsconfig/base`, whose own `extends` escapes its package by
three `../` hops, and Vite 8 (which `dsh-v0.1.7-rc` moved onto from Vite 7 while
this card was open) resolves `extends` through the
`node_modules/@yadsh/dsh-config` symlink instead of the real path, so the search
landed on `node_modules/tsconfig.base.json` and every test file failed to
transform. `pnpm nx run-many -t test` fails the same three the same way, with and
without `--coverage` — the defect is in the shared tsconfig preset, not in the
measurement. #688 moved the three to the preset's path inside the workspace and
#700 took the `base` and `browser` subpaths out of the package's `exports`, so the
next snapshot ranks them instead of omitting them.

They are absent from the table rather than ranked at the bottom, and that
distinction is the reason this section exists: `reportOnFailure` makes each of
them write a summary anyway. `dsh-test-kit` and the generator write an empty one
— no file rows, `pct: "Unknown"`. `dsh-plugin-kit` writes 0.0 over 2 lines: its
summary lists two of the twelve files under `src`, one line each, none executed.
Read straight, that is the worst package in the repository and it is not a
measured package at all.

### The red column the previous snapshot carried

The snapshot this one replaced listed 26 failing test files across nine packages,
24 of them collection errors reading `SyntaxError: Invalid or unexpected token`.
None of it was a property of `--coverage` and none of it is a fact about those
packages' tests: it was the missing decorator lowering that `dsh-v0.1.7-rc` fixed
in #603 while this card was open. The one assertion failure named there did not
survive the rebase either, and it was never a fact about the product: #603 found
that `qa-settings-card-sections` asked `section()` for the caption «Сессия» where
that helper takes a `data-testid`. On the rebased tree the measured set is green —
every test file of all 29 packages passes, three files are skipped
(`dsh-domain-experts`, `dsh-kv-persist`, `dsh-qa-browser`) — so no row of the table
above carries a red tail. `reportOnFailure` stays on regardless: a red run is still
expected to print the number it measured.

That fix is also what moved the numbers, and it was checked rather than assumed:
deleting the single `plugins: [lowerStandardDecorators()]` line from the shared
preset and re-running returns the old snapshot exactly — `dsh-openviking-memory`
47.73 over 1372/2732 against the 47.7 / 1372 of that table, `dsh-plugin-log-ui`
45.76, `dsh-prompt-firewall` 49.34, `dsh-model-safety-gate` 73.83,
`dsh-domain-experts` 74.19, five of the six red again — and putting the line back
reproduces 72.16, 57.88, 62.91, 84.23, 83.95 green. So a row that reads higher
than the last snapshot does not mean anyone wrote more tests; the code it imports
merely became loadable.

The same lever also moves a row the other way, which is the trap in comparing
snapshots across it. `dsh-session-audit` was green before #603 and is green after
it, and its percentage *fell* from 69.9 to 67.8 while its covered lines held at
459: the lowered emit attributes thirteen more lines of `src/index.ts` to the
report, 61 to 74, so the denominator grew under an unchanged suite. Percentages
from the two trees are not comparable, in either direction.

A failing suite measures its own file as unexecuted, so a red run is a floor; the
green rows above are not. `@yadsh/dsh-session-scope` (53.2 statements, 42.2
branches) and `@yadsh/dsh-doc-impact` (60.5 / 54.3) are the weakest of the lot and
they are passing — which is the kind of finding the ratio never made.

## What moved when the denominator became shared

Four plugins measured a subset of their own `src` before the preset took over,
and the preset does not narrow: `mergeConfig` concatenates arrays, so a package
that wants a smaller tree has to reach for `coverage.exclude`. Both columns below
are the *same* tree and the *same* run of the same suite — this branch measured
each package twice, once with its historical denominator restored through
`--coverage.exclude` and once as the preset configures it — so the gap is the
denominator alone, with not a single test changed.

The restoration has to go through `exclude`, and that is worth stating because the
obvious route is wrong. Passing the old glob as `--coverage.include` does *not*
recreate the old measurement: the preset's own `include` concatenates onto it, and
the modules the suite actually loaded stay in the report either way. On
`dsh-qa-browser` that shortcut printed 961 covered lines over 1550 — the preset's
covered count against a denominator missing only the one `.tsx` nothing imports —
a number that belongs to neither configuration. `exclude` is the one that wins over
`include`, and it is what these rows use:

| Package | Measured before | Stmts | Lines | Measured after | Stmts | Lines |
| --- | --- | --- | --- | --- | --- | --- |
| `@yadsh/dsh-session-audit` | `src/host/**/*.ts` + `src/config.ts` | 80.1 | 359/433 | all of `src` | 67.8 | 459/647 |
| `@yadsh/dsh-draft-sessions` | `src/host/**/*.ts` + `src/shared/**/*.ts` | 89.0 | 136/150 | all of `src` | 79.9 | 661/802 |
| `@yadsh/dsh-sleev` | `src/host/**/*.ts` + `src/shared/**/*.ts` | 89.7 | 91/98 | all of `src` | 76.8 | 194/248 |
| `@yadsh/dsh-qa-browser` | `src/**/*.ts` | 59.6 | 869/1432 | all of `src`, `.tsx` included | 58.8 | 961/1599 |

The percentage falls in every row and the executed code grows in every row:
`dsh-draft-sessions` reported 136 covered lines against its own tree and 661
against the whole one. The wider denominator did not uncover an untested client;
it stopped hiding a tested one in the count.

`dsh-qa-browser` is the row that barely moves, and its four `.tsx` files say why:
three of them are imported by the suite and partly executed (`BrowserPanel.tsx`
25/31, `chrome.tsx` 65/85, `BrowserRefusals.tsx` 2/2) while only the client entry
`index.tsx` never runs, 0/49. A package whose own glob already covered everything
its tests load gains little from the change — 92 covered lines in, 167 measured
lines in — which is the reason the four are listed with their numbers rather than
folded into one sentence.

`@yadsh/dsh-qa-integrations` configured a reporter list and no tree at all, so its
`json` reporter never wrote the summary the snapshot reads; `@yadsh/dsh-ui-repair`
had no Vitest config. Neither had ever been measured, so neither appears above.
Both are in the table now, at 86.1 (5793/6522) and 82.0 (702/834).

## The ratio this replaced

Refactor planning ranked packages by lines of test code per line of `src`. That
ratio is not a coverage number: it grows whenever a package gains tests of any
quality, it is easiest to win on a small package with a large suite, and it never
names a statement. Against the snapshot above it agrees only weakly — Spearman rho
0.53 over the 25 projects the catalog scored and this tree could measure — and it
errs in both directions. It called `audit-ui` the worst (30) while it measures 83.1
statements, fifteenth of 29; it called `session-scope` healthy (63) while its 53.2
/ 42.2 branches is the weakest row in the repository; and its best score,
`l10n-overrides` at 205, measures 90.7 — a real number, but behind the five
paired packages the ratio ranked far below it (`lightrag` 86, `tool-offload` 90,
`answer-review-gate` 104, `git-readonly` 83, `cas-results` 70). So the ratio was a
ranking of effort, not of risk, and it cannot point at the corner that is untested.
Compare this table with another measurement of the same tree; never with a line
count.
