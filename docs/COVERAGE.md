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

## Snapshot — 2026-09-25

One-off measurement, not maintained by any gate and not refreshed on release.
Reproduce it with `pnpm install --frozen-lockfile && pnpm test:coverage` and read
the summaries; the numbers below are statements/branches/functions/lines
percentages per package, with the line counts behind the last column.

| Package | Stmts | Br | Fn | Lines | Lines covered |
| --- | --- | --- | --- | --- | --- |
| `@yadsh/dsh-lightrag` | 96.2 | 89.6 | 93.9 | 97.3 | 284/292 |
| `@yadsh/dsh-plugin-generator` | 95.1 | 93.8 | 100.0 | 95.0 | 57/60 |
| `@yadsh/dsh-tool-offload` | 94.8 | 86.9 | 96.8 | 96.2 | 325/338 |
| `@yadsh/dsh-answer-review-gate` | 93.6 | 89.5 | 94.2 | 95.9 | 278/290 |
| `@yadsh/dsh-git-readonly` | 92.1 | 79.7 | 89.0 | 94.1 | 417/443 |
| `@yadsh/dsh-audit-core` | 91.8 | 81.4 | 97.6 | 95.3 | 183/192 |
| `@yadsh/dsh-cas-results` | 91.0 | 84.4 | 85.4 | 93.0 | 674/725 |
| `@yadsh/dsh-l10n-overrides` | 90.4 | 87.0 | 96.9 | 92.2 | 684/742 |
| `@yadsh/dsh-plugin-log` | 87.3 | 74.0 | 81.9 | 90.3 | 280/310 |
| `@yadsh/dsh-qa-integrations` | 85.8 | 74.3 | 83.2 | 87.9 | 5687/6468 |
| `@yadsh/dsh-model-safety-gate` | 84.2 | 76.5 | 75.5 | 86.6 | 1023/1181 |
| `@yadsh/dsh-documents` | 83.8 | 73.1 | 80.8 | 85.9 | 3088/3596 |
| `@yadsh/dsh-audit-ui` | 83.1 | 66.5 | 73.6 | 86.0 | 395/459 |
| `@yadsh/dsh-domain-experts` | 82.4 | 75.0 | 73.0 | 84.2 | 1370/1627 |
| `@yadsh/dsh-jev-compaction` | 82.2 | 77.7 | 71.8 | 84.2 | 1232/1464 |
| `@yadsh/dsh-ui-repair` | 81.2 | 70.9 | 75.4 | 83.3 | 694/833 |
| `@yadsh/dsh-user-correction-miner` | 81.0 | 69.0 | 77.9 | 81.4 | 258/317 |
| `@yadsh/dsh-qa-surface` | 80.0 | 74.8 | 74.1 | 82.0 | 11139/13591 |
| `@yadsh/dsh-draft-sessions` | 80.0 | 68.6 | 75.8 | 82.5 | 644/781 |
| `@yadsh/dsh-kv-persist` | 79.2 | 74.0 | 69.4 | 82.4 | 563/683 |
| `@yadsh/dsh-plugin-kit` | 78.6 | 80.2 | 68.0 | 80.2 | 178/222 |
| `@yadsh/dsh-sleev` | 78.1 | 73.4 | 73.9 | 79.7 | 189/237 |
| `@yadsh/dsh-preset-persona-editor` | 75.4 | 63.7 | 65.8 | 79.6 | 652/819 |
| `@yadsh/dsh-test-kit` | 75.0 | 75.0 | 81.0 | 74.4 | 32/43 |
| `@yadsh/dsh-web-fetch-authenticated` | 70.8 | 58.2 | 63.8 | 73.1 | 1814/2480 |
| `@yadsh/dsh-openviking-memory` | 70.7 | 62.7 | 73.6 | 73.8 | 2001/2712 |
| `@yadsh/dsh-session-audit` | 64.2 | 61.2 | 58.0 | 66.6 | 351/527 |
| `@yadsh/dsh-prompt-firewall` | 63.0 | 47.9 | 55.6 | 63.6 | 227/357 |
| `@yadsh/dsh-doc-impact` | 59.0 | 54.1 | 55.8 | 60.1 | 662/1102 |
| `@yadsh/dsh-plugin-log-ui` | 58.9 | 49.5 | 55.0 | 59.5 | 203/341 |
| `@yadsh/dsh-qa-browser` | 55.4 | 54.8 | 58.4 | 56.7 | 864/1524 |
| `@yadsh/dsh-session-scope` | 53.3 | 42.2 | 52.4 | 54.3 | 661/1217 |

32 projects, 37 109 of 45 973 measured lines executed (80.7%). The aggregate is
line-weighted, so `dsh-qa-surface` and `dsh-qa-integrations` carry a third of it
on their own; the per-package rows are the readable unit.

`@yadsh/dsh-git-readonly` printed its row from a red run: three of its tests read
the author of a commit the fixture creates, and a harness that exports
`GIT_AUTHOR_NAME` overrides the repo-local identity the fixture configures — git
prefers the environment. They fail with and without instrumentation wherever
that variable is set. The number is still valid — `reportOnFailure` exists for
exactly this case.

## What moved when the denominator became shared

Three plugins measured a subset of their own `src` before the preset took over,
and the preset does not narrow. Their statement percentages fell with the wider
tree while not a single test changed:

| Package | Measured before | Stmts then | Measured now | Stmts now |
| --- | --- | --- | --- | --- |
| `@yadsh/dsh-session-audit` | `src/host/**` + `src/config.ts` | 76.2 | all of `src` | 64.2 |
| `@yadsh/dsh-draft-sessions` | `src/host/**` + `src/shared/**` | 89.0 | all of `src` | 80.0 |
| `@yadsh/dsh-sleev` | `src/host/**` + `src/shared/**` | 89.5 | all of `src` | 78.1 |

`@yadsh/dsh-qa-browser` repeated the preset's own `include` and gained nothing
from it; `@yadsh/dsh-qa-integrations` configured a reporter list and no tree at
all; `@yadsh/dsh-ui-repair` had no Vitest config, so it had never been measured.

## The ratio this replaced

Refactor planning ranked packages by lines of test code per line of `src`. That
ratio is not a coverage number: it grows whenever a package gains tests of any
quality, it is easiest to win on a small package with a large suite, and it never
names a statement. Against this table it mostly agrees where it praised — the
best-scoring packages it named measure 96.2, 94.8 and 92.1 statements percent —
and it overstates the deficit it condemned: the package ranked last on the ratio
sits mid-table here, at 83.1. So the ratio was a ranking of effort, not of risk,
and it cannot point at the corner that is untested. Compare this table with
another measurement of the same tree; never with a line count.
